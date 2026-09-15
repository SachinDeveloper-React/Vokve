import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import * as Keychain from 'react-native-keychain';
import { getMMKV } from '../stores';
import type { AuthTokens } from '../types/models';
import { deviceApi } from './api/endpoints';
import { setDeviceReregistrar, setRequestHeadersProvider } from './api/client';
import { toApiError } from './api/errors';
import { logger } from '../utils/logger';

/**
 * Who this install is, to the server (BACKEND.md §13.1).
 *
 * Three ids, each for a different job:
 *   installId  — ours. A UUID minted on first launch and kept in the Keychain,
 *                so it survives a reinstall on iOS and an update on both.
 *   vendorId   — the OS's (`identifierForVendor` / `ANDROID_ID`), which
 *                survives our reinstall on Android and lets the server tie
 *                re-installs together.
 *   deviceId   — the server's, returned by `POST /devices/register`, and the
 *                one every later request carries in `X-Vokve-Device-Id`.
 *
 * The install id is a credential-adjacent secret (it is half of the device
 * binding on refresh tokens), so it lives in the Keychain; the server id is
 * not, so it can sit in MMKV where it is cheap to read on every request.
 */
const INSTALL_SERVICE = 'vokve.device.install';
const DEVICE_ID_KEY = 'vokve.device.id';
const storage = () => getMMKV();

let installIdCache: string | null = null;

function uuid(): string {
  // RFC 4122 v4 from Math.random is fine here: the id only needs to be unique
  // per install, not unguessable — the server binds it to a session anyway.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    // The variant nibble is 8, 9, a or b.
    const nibble = c === 'x' ? r : 8 + (r % 4);
    return nibble.toString(16);
  });
}

export async function getInstallId(): Promise<string> {
  if (installIdCache) return installIdCache;
  try {
    const entry = await Keychain.getGenericPassword({ service: INSTALL_SERVICE });
    if (entry && entry.password) {
      installIdCache = entry.password;
      return installIdCache;
    }
    const fresh = uuid();
    await Keychain.setGenericPassword('install', fresh, { service: INSTALL_SERVICE });
    installIdCache = fresh;
    return fresh;
  } catch (error) {
    logger.error('device', 'Failed to read or mint install id', error);
    // Never block the app on the Keychain: a per-process id still lets the
    // session work, and the next launch will try again.
    installIdCache = installIdCache ?? uuid();
    return installIdCache;
  }
}

export function getDeviceId(): string | null {
  return storage().getString(DEVICE_ID_KEY) ?? null;
}

export function clearDeviceId(): void {
  storage().remove(DEVICE_ID_KEY);
}

/** The headers every request carries (BACKEND.md §3.8). Synchronous on purpose — it runs in the axios interceptor. */
export function requestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Vokve-Platform': Platform.OS === 'ios' ? 'ios' : 'android',
    'X-Vokve-App-Version': DeviceInfo.getVersion(),
    'X-Vokve-Build': DeviceInfo.getBuildNumber(),
    'X-Vokve-OS-Version': DeviceInfo.getSystemVersion(),
    'X-Vokve-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Kolkata',
    'X-Vokve-Locale': Intl.DateTimeFormat().resolvedOptions().locale ?? 'en-IN',
  };
  const deviceId = getDeviceId();
  if (deviceId) headers['X-Vokve-Device-Id'] = deviceId;
  return headers;
}

export interface DeviceProfile {
  installId: string;
  vendorId: string | null;
  platform: 'ios' | 'android';
  profile: {
    brand: string; manufacturer: string; model: string; deviceName: string; osVersion: string;
    isEmulator: boolean; isTablet: boolean; totalMemoryMb: number; carrier: string | undefined;
    locale: string; timezone: string; hasBiometrics: boolean;
    app: { version: string; build: string; bundleId: string };
  };
  signals: { developerMode?: boolean };
}

/** Everything the server records about the device (RULES DV4), read from react-native-device-info. */
export async function collectProfile(): Promise<DeviceProfile> {
  const [installId, vendorId, manufacturer, deviceName, isEmulator, totalMemory, carrier, hasBiometrics] = await Promise.all([
    getInstallId(),
    DeviceInfo.getUniqueId().catch(() => null),
    DeviceInfo.getManufacturer().catch(() => ''),
    DeviceInfo.getDeviceName().catch(() => ''),
    DeviceInfo.isEmulator().catch(() => false),
    DeviceInfo.getTotalMemory().catch(() => 0),
    DeviceInfo.getCarrier().catch(() => undefined),
    DeviceInfo.isPinOrFingerprintSet().catch(() => false),
  ]);
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  return {
    installId,
    vendorId,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    profile: {
      brand: DeviceInfo.getBrand(),
      manufacturer,
      model: DeviceInfo.getModel(),
      deviceName,
      osVersion: DeviceInfo.getSystemVersion(),
      isEmulator,
      isTablet: DeviceInfo.isTablet(),
      totalMemoryMb: Math.round(totalMemory / (1024 * 1024)),
      carrier: carrier || undefined,
      locale: resolved.locale ?? 'en-IN',
      timezone: resolved.timeZone ?? 'Asia/Kolkata',
      hasBiometrics,
      app: { version: DeviceInfo.getVersion(), build: DeviceInfo.getBuildNumber(), bundleId: DeviceInfo.getBundleId() },
    },
    signals: {},
  };
}

/**
 * Registers this install with the server and remembers the id it hands back.
 * Called after every sign-in / session restore, before any other authenticated
 * call — the server answers 428 to anything else from an unknown device.
 *
 * Throws an `ApiError` rather than swallowing it: the caller knows whether a
 * failure here should end the session (`TOO_MANY_DEVICES`), wait for a
 * connection (network), or be ignored (the 428 self-heal in the client will
 * try again on the next request).
 */
export async function registerDevice(tokens: AuthTokens | null): Promise<string> {
  try {
    const profile = await collectProfile();
    const result = await deviceApi.register(profile, tokens?.refreshToken ?? null);
    storage().set(DEVICE_ID_KEY, result.deviceId);
    return result.deviceId;
  } catch (error) {
    const apiError = toApiError(error);
    logger.warn('device', `Device registration failed: ${apiError.code ?? apiError.kind}`, apiError);
    throw apiError;
  }
}

// The client cannot import this module (it would close an import cycle), so
// the two things it needs from here are handed over at import time.
setRequestHeadersProvider(requestHeaders);
setDeviceReregistrar(tokens => registerDevice(tokens).catch(() => null));
