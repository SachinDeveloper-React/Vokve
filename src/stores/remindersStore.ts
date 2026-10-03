import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { hydrationApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type {
  HydrationReminder,
  HydrationReminderPlan,
  ReminderSlot,
} from '../types/models';
import { logger } from '../utils/logger';
import { uuid } from '../utils/uuid';
import { mmkvStorage } from './index';

/** Monday-first, matching the calendar and the day letters on the screen. */
export const REPEAT_DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** How old a synced plan may be before opening the screen fetches it again. */
export const REMINDERS_STALE_AFTER_MS = 5 * 60_000;

/** Minutes since midnight, for ordering and for finding the next one due. */
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

const byTime = (a: HydrationReminder, b: HydrationReminder) =>
  minutesOf(a.time) - minutesOf(b.time);

interface RemindersState {
  /** The plan as the server last held it, with any edit on its way; null until the first sync. */
  plan: HydrationReminderPlan | null;
  syncedAt: string | null;
  isSyncing: boolean;
  /** Why the last sync or save failed; cleared by the next that succeeds. */
  syncError: string | null;

  hydrateFromServer: () => Promise<void>;
  refreshIfStale: () => Promise<void>;
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

/** The newest save's number: an older answer arriving late must not undo a newer edit. */
let latestSave = 0;

/**
 * The hydration reminder plan (RULES Y5), kept by the server so a new phone
 * opens on the same plan — the default one until the user changes it.
 *
 * One list for both the preset chips and the custom rows, split by `slot`
 * when it is drawn. An edit shows at once and the whole plan is sent; the
 * server's answer replaces it, and a refusal puts the server's plan back.
 *
 * Nothing here schedules a notification yet. This is the plan the scheduler
 * will read when the native side lands.
 */
export const useRemindersStore = create<RemindersState>()(
  persist(
    (set, get) => {
      /** Applies an edit here at once, then sends the whole plan. */
      const edit = (
        change: (plan: HydrationReminderPlan) => HydrationReminderPlan,
      ) => {
        const current = get().plan;
        if (current === null) {
          return;
        }
        const next = change(current);
        if (next === current) {
          return;
        }
        set({ plan: next });
        const save = (latestSave += 1);
        hydrationApi
          .saveReminders(next, { idempotencyKey: uuid() })
          .then(saved => {
            if (save === latestSave) {
              set({
                plan: saved,
                syncedAt: new Date().toISOString(),
                syncError: null,
              });
            }
          })
          .catch(error => {
            const apiError = toApiError(error);
            logger.warn('remindersStore', 'Plan save failed', apiError);
            set({ syncError: apiError.message });
            // The server's plan is the truth: show it again rather than an
            // edit it never took.
            if (save === latestSave) {
              get().hydrateFromServer();
            }
          });
      };

      return {
        plan: null,
        syncedAt: null,
        isSyncing: false,
        syncError: null,

        hydrateFromServer: async () => {
          if (get().isSyncing) {
            return;
          }
          set({ isSyncing: true });
          const save = latestSave;
          try {
            const plan = await hydrationApi.reminders();
            // An edit made while this was on its way is newer than it.
            if (save === latestSave) {
              set({
                plan,
                syncedAt: new Date().toISOString(),
                syncError: null,
              });
            }
            set({ isSyncing: false });
          } catch (error) {
            const apiError = toApiError(error);
            logger.warn('remindersStore', 'Plan sync failed', apiError);
            set({ isSyncing: false, syncError: apiError.message });
          }
        },

        refreshIfStale: async () => {
          const { syncedAt, isSyncing, hydrateFromServer } = get();
          if (isSyncing) {
            return;
          }
          const age = syncedAt
            ? Date.now() - new Date(syncedAt).getTime()
            : Infinity;
          if (age < REMINDERS_STALE_AFTER_MS) {
            return;
          }
          await hydrateFromServer();
        },

        setEnabled: value =>
          edit(plan =>
            plan.enabled === value ? plan : { ...plan, enabled: value },
          ),

        toggleReminder: id =>
          edit(plan => ({
            ...plan,
            reminders: plan.reminders.map(reminder =>
              reminder.id === id
                ? { ...reminder, enabled: !reminder.enabled }
                : reminder,
            ),
          })),

        addReminder: (time, slot = 'custom') =>
          edit(plan => {
            const exists = plan.reminders.some(
              reminder => reminder.time === time && reminder.slot === slot,
            );
            if (exists) {
              return plan;
            }
            const entry: HydrationReminder = {
              id: uuid(),
              time,
              slot,
              enabled: true,
            };
            return {
              ...plan,
              reminders: [...plan.reminders, entry].sort(byTime),
            };
          }),

        removeReminder: id =>
          edit(plan => ({
            ...plan,
            reminders: plan.reminders.filter(reminder => reminder.id !== id),
          })),

        setSound: sound => edit(plan => ({ ...plan, sound })),
        setVibration: value => edit(plan => ({ ...plan, vibration: value })),

        toggleRepeatDay: day =>
          edit(plan => ({
            ...plan,
            repeatDays: plan.repeatDays.includes(day)
              ? plan.repeatDays.filter(entry => entry !== day)
              : [...plan.repeatDays, day].sort((a, b) => a - b),
          })),

        reset: () =>
          set({
            plan: null,
            syncedAt: null,
            isSyncing: false,
            syncError: null,
          }),
      };
    },
    {
      name: 'vokve.reminders',
      storage: createJSONStorage(() => mmkvStorage),
      // v2: the server's plan. A v1 store held a plan made on the phone,
      // which the server never saw; it is dropped for the server's.
      version: 2,
      migrate: () => ({ plan: null, syncedAt: null }),
      partialize: state => ({ plan: state.plan, syncedAt: state.syncedAt }),
    },
  ),
);

const NO_REMINDERS: HydrationReminder[] = [];
const NO_DAYS: number[] = [];

export const useReminderPlan = () => useRemindersStore(s => s.plan);
export const useRemindersEnabled = () =>
  useRemindersStore(s => s.plan?.enabled ?? false);
export const useReminderSound = () =>
  useRemindersStore(s => s.plan?.sound ?? '');
export const useReminderVibration = () =>
  useRemindersStore(s => s.plan?.vibration ?? false);
export const useRepeatDays = () =>
  useRemindersStore(s => s.plan?.repeatDays ?? NO_DAYS);

/**
 * How many times are switched on — the figure the screen leads with.
 *
 * Zero once the master switch is off, because that is what the number means to
 * a reader: how many reminders will actually arrive, not how many rows the
 * plan happens to hold.
 */
export const useActiveReminderCount = () =>
  useRemindersStore(s =>
    s.plan?.enabled
      ? s.plan.reminders.filter(reminder => reminder.enabled).length
      : 0,
  );

/** The plan's times for one block, in clock order. */
export const useRemindersInSlot = (slot: ReminderSlot): HydrationReminder[] => {
  const reminders = useRemindersStore(s => s.plan?.reminders ?? NO_REMINDERS);
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

  const active = reminders.filter(reminder => reminder.enabled).sort(byTime);

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
  const reminders = useRemindersStore(s => s.plan?.reminders ?? NO_REMINDERS);
  const enabled = useRemindersEnabled();
  return useMemo(
    () => nextReminderTime(reminders, enabled),
    [enabled, reminders],
  );
};
