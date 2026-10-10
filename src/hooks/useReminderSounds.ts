import { useMemo } from 'react';
import {
  FALLBACK_REMINDER_SOUNDS,
  isSoundBundled,
} from '../constants/reminderSounds';
import { hydrationApi } from '../services/api/endpoints';
import type { ReminderSound } from '../types/models';
import { useServerRead } from './useServerRead';

/**
 * The sounds a reminder may arrive with (RULES Y5).
 *
 * The server's list, so the picker can never offer one a plan would be
 * refused for — filtered to the ones this build actually carries audio for,
 * because a sound the app cannot play is a sound the picker should not
 * promise. Until the list arrives, and if it never does, the bundled ones:
 * the picker is reachable offline, and an empty list would read as "this
 * phone cannot change its sound", which is not true.
 */
export function useReminderSounds(): ReminderSound[] {
  const { data } = useServerRead('hydration:reminder-sounds', () =>
    hydrationApi.reminderSounds(),
  );

  return useMemo(() => {
    if (data === null) return FALLBACK_REMINDER_SOUNDS;
    const playable = data.filter(sound => isSoundBundled(sound.id));
    return playable.length > 0 ? playable : FALLBACK_REMINDER_SOUNDS;
  }, [data]);
}
