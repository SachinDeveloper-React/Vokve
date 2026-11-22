import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/** What the phone is showing, and what it could show. */
export type AppIconState = {
  /** False where the OS cannot change an app's icon (an iPad without the API, say). */
  supported: boolean;
  /** The key of the icon on the home screen right now. */
  current: string;
  /**
   * Android only: the key asked for that is waiting for the app to leave
   * the screen. Swapping the launcher entry while the app is in front can
   * close it, so the swap happens on the way out. Always null on iOS.
   */
  pending: string | null;
  /** Every key this build carries, the default included. */
  available: Array<string>;
};

export interface Spec extends TurboModule {
  getState(): Promise<AppIconState>;
  /**
   * Shows the icon with this key. Resolves `applied`, `pending` (Android:
   * on the way out) or `unchanged`; rejects `UNKNOWN_ICON` for a key the
   * build does not carry, `UNSUPPORTED`, `NOT_ACTIVE` (iOS refuses while the
   * app is not in front) or `SET_FAILED`.
   */
  setIcon(key: string): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>('VokveAppIcon');
