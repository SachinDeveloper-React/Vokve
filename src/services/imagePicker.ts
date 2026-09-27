import { PermissionsAndroid, Platform } from 'react-native';
import {
  launchCamera,
  launchImageLibrary,
  type Asset,
  type CameraOptions,
  type ImageLibraryOptions,
} from 'react-native-image-picker';
import { logger } from '../utils/logger';

/**
 * The longest edge an avatar is stored at, and how hard it is compressed.
 *
 * Downscaled on the phone rather than on the server: a modern camera hands
 * back a 12-megapixel file, and uploading that to crop it to a 64pt disc
 * would cost the member several megabytes of their data to throw away.
 * 512px at 0.8 quality lands around 40–80 KB, well under the API's cap.
 */
export const AVATAR_MAX_EDGE = 512;
const AVATAR_QUALITY = 0.8;

/** What the upload needs: the bytes, and what they are. */
export interface PickedImage {
  /** Base64, without a `data:` prefix — what the API takes. */
  data: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** A local URI, for showing the choice before the upload finishes. */
  uri: string | null;
}

export type PickResult =
  | { status: 'picked'; image: PickedImage }
  /** The member closed the picker. Not an error — nothing to say about it. */
  | { status: 'cancelled' }
  /** The camera was refused at the OS level; the app cannot ask again itself. */
  | { status: 'denied' }
  | { status: 'failed'; message: string };

const BASE_OPTIONS = {
  mediaType: 'photo',
  includeBase64: true,
  maxWidth: AVATAR_MAX_EDGE,
  maxHeight: AVATAR_MAX_EDGE,
  quality: AVATAR_QUALITY,
} as const satisfies Partial<CameraOptions & ImageLibraryOptions>;

/** The three types the API stores; anything else is refused before it is sent. */
function typeOf(asset: Asset): PickedImage['contentType'] | null {
  const type = (asset.type ?? '').toLowerCase();
  if (type.includes('png')) return 'image/png';
  if (type.includes('webp')) return 'image/webp';
  if (type.includes('jpeg') || type.includes('jpg')) return 'image/jpeg';
  // Some Android providers hand back no type at all; the picker has already
  // re-encoded to JPEG by this point, so that is the safe assumption.
  return type === '' ? 'image/jpeg' : null;
}

function toResult(asset: Asset | undefined): PickResult {
  if (!asset?.base64) {
    return { status: 'failed', message: 'That photo could not be read.' };
  }
  const contentType = typeOf(asset);
  if (!contentType) {
    return { status: 'failed', message: 'Choose a JPEG, PNG or WebP image.' };
  }
  return {
    status: 'picked',
    image: { data: asset.base64, contentType, uri: asset.uri ?? null },
  };
}

/**
 * Asks for the camera on Android.
 *
 * iOS does this from the Info.plist string the moment the camera opens, and
 * the library handles it; Android needs the runtime request first or the
 * camera activity returns empty with no explanation.
 */
async function ensureCamera(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.CAMERA,
    {
      title: 'Take a profile photo',
      message: 'VOKVE needs the camera to take your profile photo.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Opens the gallery. No permission is asked for: on Android 13+ the system
 * photo picker returns the one image the member chose without granting the
 * app the gallery, and on iOS the limited-library flow does the same.
 */
export async function pickFromLibrary(): Promise<PickResult> {
  try {
    const response = await launchImageLibrary({
      ...BASE_OPTIONS,
      selectionLimit: 1,
    });
    if (response.didCancel) return { status: 'cancelled' };
    if (response.errorCode === 'permission') return { status: 'denied' };
    if (response.errorCode) {
      return {
        status: 'failed',
        message: response.errorMessage ?? 'That photo could not be opened.',
      };
    }
    return toResult(response.assets?.[0]);
  } catch (error) {
    logger.warn('imagePicker', 'Library pick failed', error);
    return { status: 'failed', message: 'That photo could not be opened.' };
  }
}

export async function takePhoto(): Promise<PickResult> {
  try {
    if (!(await ensureCamera())) {
      return { status: 'denied' };
    }
    const response = await launchCamera({
      ...BASE_OPTIONS,
      saveToPhotos: false,
    });
    if (response.didCancel) return { status: 'cancelled' };
    if (
      response.errorCode === 'permission' ||
      response.errorCode === 'camera_unavailable'
    ) {
      return { status: 'denied' };
    }
    if (response.errorCode) {
      return {
        status: 'failed',
        message: response.errorMessage ?? 'The camera could not be opened.',
      };
    }
    return toResult(response.assets?.[0]);
  } catch (error) {
    logger.warn('imagePicker', 'Camera pick failed', error);
    return { status: 'failed', message: 'The camera could not be opened.' };
  }
}
