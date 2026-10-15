import StepTracker from 'react-native-step-tracker-pro';
import { getMMKV } from '../stores';
import { useStepsStore } from '../stores/stepsStore';
import type { DeviceHealthReport } from '../types/models';
import { logger } from '../utils/logger';
import { telemetryApi } from './api/endpoints';
import { toApiError } from './api/errors';
import { getDeviceId } from './device';

/**
 * This install's verdict on itself, sent to the server (RULES P17).
 *
 * The commonest complaint an app like this gets is "my steps are not
 * counting", and the answer has always been on the phone: a foreground
 * service an OEM killed, a Health Connect grant withdrawn in Settings, a
 * sync that has been failing since Tuesday. The app reads all three for its
 * own screens — the tracking screen shows the OEM guidance from exactly
 * this data — and until now none of it ever left the device, so the same
 * question could not be answered without the member on the phone.
 *
 * Operational, not analytics: kept whatever the usage-analytics switch says,
 * for the same reason as the permission snapshot (RULES P7, P14). It says
 * nothing about what the member likes and everything about whether the app
 * is working.
 *
 * Diffed against what was last accepted, so a phone where nothing moves
 * reports twice a day and a phone whose service just died reports at once.
 */
const SENT_KEY = 'vokve.deviceHealth.sent';
/** How long a report stands before it is sent again unchanged. */
const RECHECK_MS = 12 * 60 * 60 * 1000;

interface Sent {
  signature: string;
  at: number;
}

function storage() {
  try {
    return getMMKV();
  } catch {
    return null;
  }
}

function sentCache(): Sent | null {
  const raw = storage()?.getString(SENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Sent>;
    return typeof parsed.signature === 'string' && typeof parsed.at === 'number'
      ? { signature: parsed.signature, at: parsed.at }
      : null;
  } catch {
    return null;
  }
}

function rememberSent(signature: string): void {
  try {
    storage()?.set(SENT_KEY, JSON.stringify({ signature, at: Date.now() }));
  } catch {
    // Then it is sent again next time, which costs one request.
  }
}

/**
 * Builds the report from the tracker and the steps store.
 *
 * `getTrackingHealth` is asked of the tracker directly rather than read from
 * the store, because the store's copy is only as fresh as the last screen
 * that looked — and the whole point here is to catch a service that died
 * while nobody was looking. The rest is already in the store: the sync's
 * state is only ever written there, and asking Health Connect again would
 * spend its rate limit on an answer the session already has.
 */
export async function collectDeviceHealth(): Promise<DeviceHealthReport> {
  const state = useStepsStore.getState();
  const health = await StepTracker.getTrackingHealth().catch(error => {
    logger.debug('deviceHealth', 'The tracker would not answer', error);
    return null;
  });

  return {
    tracking: {
      state: state.trackingState ?? undefined,
      wanted: state.trackingWanted,
      ...(health
        ? {
            serviceAlive: health.serviceAlive,
            looksDead: health.looksDead,
            heartbeatAgeMs: health.heartbeatAgeMs ?? undefined,
            recoveryCount: health.recoveryCount,
            lastRecoveryReason: health.lastRecoveryReason ?? null,
            batteryOptimizationEnabled: health.batteryOptimizationEnabled,
            aggressiveOem: health.aggressiveOem,
            manufacturer: health.manufacturer ?? null,
          }
        : {}),
    },
    healthConnect: state.healthConnect
      ? {
          availability: state.healthConnect.availability ?? null,
          canRead: state.healthConnect.canRead ?? undefined,
          canWrite: state.healthConnect.canWrite ?? undefined,
          grantedReadTypes: state.healthConnect.grantedReadTypes
            ? [...state.healthConnect.grantedReadTypes].slice(0, 10)
            : undefined,
        }
      : undefined,
    sync: {
      status: state.syncStatus,
      lastSyncedAt: state.lastSyncedAt
        ? new Date(state.lastSyncedAt).toISOString()
        : null,
      queued: state.queue.length,
      error: state.syncError,
      todaySteps: state.today?.steps ?? undefined,
    },
  };
}

/**
 * Sends it, unless the same thing was accepted recently.
 *
 * Never throws: this is housekeeping, and nothing the member sees depends on
 * it. The figures that move on every walk — today's step count, the
 * heartbeat's age — are deliberately left out of the signature, or a phone
 * being used would report on every foreground and the diff would be
 * pointless.
 */
export async function reportDeviceHealth({
  force = false,
}: { force?: boolean } = {}): Promise<void> {
  if (!getDeviceId()) return;
  try {
    const report = await collectDeviceHealth();
    const signature = signatureOf(report);
    const cached = sentCache();
    const changed = cached?.signature !== signature;
    if (!force && !changed && Date.now() - (cached?.at ?? 0) < RECHECK_MS) {
      return;
    }
    await telemetryApi.reportDeviceHealth(report);
    rememberSent(signature);
  } catch (error) {
    logger.debug('deviceHealth', 'Health not reported', toApiError(error));
  }
}

/** The parts whose change is worth a request of its own. */
function signatureOf(report: DeviceHealthReport): string {
  const { tracking, healthConnect, sync } = report;
  return JSON.stringify([
    tracking?.state ?? null,
    tracking?.wanted ?? null,
    tracking?.looksDead ?? null,
    tracking?.serviceAlive ?? null,
    tracking?.recoveryCount ?? null,
    tracking?.batteryOptimizationEnabled ?? null,
    healthConnect?.availability ?? null,
    healthConnect?.canRead ?? null,
    healthConnect?.canWrite ?? null,
    sync?.status ?? null,
    sync?.error ?? null,
  ]);
}
