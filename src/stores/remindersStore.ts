import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { HydrationReminder, ReminderSlot } from '../types/models';
import { mmkvStorage } from './index';

/** Monday-first, matching the calendar and the day letters on the screen. */
export const REPEAT_DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/**
 * The times the app suggests, by block.
 *
 * Seeded rather than invented per install: a reminder plan the user has to
 * build from nothing is one nobody builds, and these are the hours a day of
 * drinking water actually falls into.
 */
const PRESET_TIMES: Record<Exclude<ReminderSlot, 'custom'>, string[]> = {
  morning: ['07:00', '08:30', '10:00'],
  afternoon: ['13:00', '15:30'],
  evening: ['18:00', '20:00'],
};

function seedReminders(): HydrationReminder[] {
  const presets = (Object.keys(PRESET_TIMES) as (keyof typeof PRESET_TIMES)[])
    .flatMap(slot =>
      PRESET_TIMES[slot].map(time => ({
        id: `${slot}-${time}`,
        time,
        slot: slot as ReminderSlot,
        enabled: true,
      })),
    );

  return [
    ...presets,
    { id: 'custom-11-00', time: '11:00', slot: 'custom', enabled: true },
    { id: 'custom-21-30', time: '21:30', slot: 'custom', enabled: true },
  ];
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Minutes since midnight, for ordering and for finding the next one due. */
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

const byTime = (a: HydrationReminder, b: HydrationReminder) =>
  minutesOf(a.time) - minutesOf(b.time);

interface RemindersState {
  /** The master switch. Off, nothing fires however many times are listed. */
  enabled: boolean;
  /** Every time the plan holds, preset and custom alike. */
  reminders: HydrationReminder[];
  /** The notification sound, by name — "Default", "Droplet", "Chime". */
  sound: string;
  vibration: boolean;
  /** Weekday indices the plan repeats on, Monday first. */
  repeatDays: number[];

  setEnabled: (value: boolean) => void;
  toggleReminder: (id: string) => void;
  /** Adds a time to a block. A time already in that block is not duplicated. */
  addReminder: (time: string, slot?: ReminderSlot) => void;
  removeReminder: (id: string) => void;
  setSound: (sound: string) => void;
  setVibration: (value: boolean) => void;
  toggleRepeatDay: (day: number) => void;
  reset: () => void;
}

/**
 * The hydration reminder plan.
 *
 * One list for both the preset chips and the custom rows, split by `slot` when
 * it is drawn. The figures at the top of the screen — how many are on, which
 * one is next — are counts over that single list, so they cannot disagree with
 * the chips underneath them the way two parallel lists eventually would.
 *
 * Nothing here schedules a notification yet. This is the plan the scheduler
 * will read when the native side lands, which is why it persists.
 */
export const useRemindersStore = create<RemindersState>()(
  persist(
    set => ({
      enabled: true,
      reminders: seedReminders(),
      sound: 'Default',
      vibration: true,
      repeatDays: EVERY_DAY,

      setEnabled: value => set({ enabled: value }),

      toggleReminder: id =>
        set(state => ({
          reminders: state.reminders.map(reminder =>
            reminder.id === id
              ? { ...reminder, enabled: !reminder.enabled }
              : reminder,
          ),
        })),

      addReminder: (time, slot = 'custom') =>
        set(state => {
          const exists = state.reminders.some(
            reminder => reminder.time === time && reminder.slot === slot,
          );
          if (exists) {
            return state;
          }

          const entry: HydrationReminder = {
            id: createId(),
            time,
            slot,
            enabled: true,
          };

          return { reminders: [...state.reminders, entry].sort(byTime) };
        }),

      removeReminder: id =>
        set(state => ({
          reminders: state.reminders.filter(reminder => reminder.id !== id),
        })),

      setSound: sound => set({ sound }),
      setVibration: value => set({ vibration: value }),

      toggleRepeatDay: day =>
        set(state => ({
          repeatDays: state.repeatDays.includes(day)
            ? state.repeatDays.filter(entry => entry !== day)
            : [...state.repeatDays, day].sort((a, b) => a - b),
        })),

      reset: () =>
        set({
          enabled: true,
          reminders: seedReminders(),
          sound: 'Default',
          vibration: true,
          repeatDays: EVERY_DAY,
        }),
    }),
    {
      name: 'vokve.reminders',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
    },
  ),
);

export const useRemindersEnabled = () => useRemindersStore(s => s.enabled);
export const useReminderSound = () => useRemindersStore(s => s.sound);
export const useReminderVibration = () => useRemindersStore(s => s.vibration);
export const useRepeatDays = () => useRemindersStore(s => s.repeatDays);

/**
 * How many times are switched on — the figure the screen leads with.
 *
 * Zero once the master switch is off, because that is what the number means to
 * a reader: how many reminders will actually arrive today, not how many rows
 * the plan happens to hold.
 */
export const useActiveReminderCount = () =>
  useRemindersStore(s =>
    s.enabled ? s.reminders.filter(reminder => reminder.enabled).length : 0,
  );

/** The plan's times for one block, in clock order. */
export const useRemindersInSlot = (slot: ReminderSlot): HydrationReminder[] => {
  const reminders = useRemindersStore(s => s.reminders);
  return useMemo(
    () => reminders.filter(reminder => reminder.slot === slot).sort(byTime),
    [reminders, slot],
  );
};

/**
 * The next reminder due, as `HH:mm`, or null when none will come.
 *
 * Wraps to the first of tomorrow once the day's last has passed, so the line
 * never reads as empty for the whole evening. Computed from `now` passed in
 * rather than read here, so a screen that wants it recomputed on the minute
 * can do so without this hook holding a timer of its own.
 */
export function nextReminderTime(
  reminders: HydrationReminder[],
  enabled: boolean,
  now: Date = new Date(),
): string | null {
  if (!enabled) {
    return null;
  }

  const active = reminders
    .filter(reminder => reminder.enabled)
    .sort(byTime);

  if (active.length === 0) {
    return null;
  }

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const upcoming = active.find(
    reminder => minutesOf(reminder.time) > minutesNow,
  );

  return (upcoming ?? active[0]).time;
}

export const useNextReminderTime = (): string | null => {
  const reminders = useRemindersStore(s => s.reminders);
  const enabled = useRemindersStore(s => s.enabled);
  return useMemo(
    () => nextReminderTime(reminders, enabled),
    [enabled, reminders],
  );
};
