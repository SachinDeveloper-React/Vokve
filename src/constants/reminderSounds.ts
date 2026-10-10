import { Platform } from 'react-native';
import type { ReminderSound } from '../types/models';

/**
 * Which audio a reminder sound id plays.
 *
 * The list of sounds is the server's (`GET /hydration/reminders/sounds`) —
 * so the picker can never offer one a plan would be refused for — but the
 * audio itself has to be in the app binary: a notification sound is a file
 * the OS reads at the moment it rings, long after any request could fetch
 * one. This file is the bridge: the server's id, and what this build has
 * for it.
 *
 * Which means the two can disagree. A release of the server can add a sound
 * before the release of the app that carries it, and an app that has no
 * audio for an id must still ring — so an unknown id falls back to the
 * phone's own notification sound rather than arriving silent. Only `silent`
 * is deliberately quiet.
 *
 * Adding a sound: drop `<id>.wav` into `android/app/src/main/res/raw` and
 * into the iOS bundle (`ios/vokve/Sounds`, added to the Xcode target), add
 * it here, and add it to the server's `hydration.sounds`.
 */

/** The sound a plan falls back to. The same id the server defaults to. */
export const DEFAULT_SOUND_ID = 'default';

/** A reminder that arrives with no sound at all — the vibration only. */
export const SILENT_SOUND_ID = 'silent';

/**
 * The ids this build carries audio for.
 *
 * Android wants the raw resource's name with no extension; iOS wants the
 * bundled file's name with one. Spelled out per platform rather than
 * derived, because a mismatch here is a silent notification and not a
 * crash — there is nothing to find it by at runtime.
 */
const BUNDLED: Record<string, { android: string; ios: string }> = {
  water_drop: { android: 'water_drop', ios: 'water_drop.wav' },
  chime: { android: 'chime', ios: 'chime.wav' },
  bell: { android: 'bell', ios: 'bell.wav' },
};

/**
 * What to hand the OS for a sound id.
 *
 * `system` and `silent` are not file names on any platform, so they are
 * states rather than strings — the caller has to decide what each means for
 * the channel or the notification it is building, and a string would let it
 * forget.
 */
export type SoundAsset =
  | { kind: 'system' }
  | { kind: 'silent' }
  | { kind: 'file'; name: string };

export function soundAssetFor(id: string): SoundAsset {
  if (id === SILENT_SOUND_ID) return { kind: 'silent' };
  const bundled = BUNDLED[id];
  if (!bundled) return { kind: 'system' };
  return { kind: 'file', name: Platform.OS === 'ios' ? bundled.ios : bundled.android };
}

/** Whether this build has the audio for a sound the server offers. */
export function isSoundBundled(id: string): boolean {
  return id === DEFAULT_SOUND_ID || id === SILENT_SOUND_ID || id in BUNDLED;
}

/**
 * The list to show before the server's has arrived, and if it never does.
 *
 * The picker is reachable offline — it is two taps inside a screen the plan
 * is cached for — and a list of nothing would read as "this phone cannot
 * change its reminder sound", which is not true. These are the ids this
 * build has audio for, which is the honest subset.
 */
export const FALLBACK_REMINDER_SOUNDS: ReminderSound[] = [
  {
    id: DEFAULT_SOUND_ID,
    label: 'Default',
    description: 'Your phone’s notification sound',
  },
  { id: 'water_drop', label: 'Water Drop', description: 'A single drop' },
  { id: 'chime', label: 'Chime', description: 'Two soft notes' },
  { id: 'bell', label: 'Bell', description: 'A short bell' },
  {
    id: SILENT_SOUND_ID,
    label: 'Silent',
    description: 'No sound — vibration only',
  },
];

/**
 * What to call a sound id on screen.
 *
 * Falls back to the id itself rather than to "Default": a row reading
 * "Default" while the plan holds something else would be a lie about the
 * user's own setting, where the raw id is at least a true answer.
 */
export function soundLabelFor(id: string, sounds: ReminderSound[]): string {
  const known = sounds.find(sound => sound.id === id);
  if (known) return known.label;
  const fallback = FALLBACK_REMINDER_SOUNDS.find(sound => sound.id === id);
  return fallback?.label ?? id;
}
