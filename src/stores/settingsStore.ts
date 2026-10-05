import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { settingsApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { UnitSystem, UserSettings } from '../types/models';
import { logger } from '../utils/logger';
import { mmkvStorage } from './index';

interface SettingsState {
  units: UnitSystem;
  /** Steps per day the user is aiming for. */
  dailyStepGoal: number;
  /** Water target for the day, in millilitres. */
  dailyWaterGoalMl: number;
  restTimerSeconds: number;
  hapticsEnabled: boolean;
  workoutRemindersEnabled: boolean;
  /** Keeps the screen awake while a workout is running. */
  keepAwakeDuringWorkout: boolean;
  /** When the server last confirmed these; null until the first sync. */
  syncedAt: string | null;

  setUnits: (units: UnitSystem) => void;
  /**
   * Sets the step goal and waits for the server to keep it, so the goal
   * screen can say whether it did. Throws when it did not, with the goal
   * put back as it was.
   */
  saveDailyStepGoal: (steps: number) => Promise<void>;
  setDailyWaterGoalMl: (ml: number) => void;
  setRestTimerSeconds: (seconds: number) => void;
  toggleHaptics: () => void;
  toggleWorkoutReminders: () => void;
  toggleKeepAwake: () => void;
  /** Takes the server's copy (`GET /me/settings`) — the one every phone shares. */
  hydrateFromServer: () => Promise<void>;
  /** Back to a new account's defaults — signing out. */
  reset: () => void;
}

const DEFAULTS = {
  units: 'metric' as UnitSystem,
  dailyStepGoal: 10000,
  dailyWaterGoalMl: 2500,
  restTimerSeconds: 90,
  hapticsEnabled: true,
  workoutRemindersEnabled: true,
  keepAwakeDuringWorkout: true,
  syncedAt: null,
};

const fromServer = (settings: UserSettings) => ({
  ...settings,
  syncedAt: new Date().toISOString(),
});

/**
 * The user's targets and switches. The server keeps them (`/me/settings`,
 * RULES P3), so a goal set on one phone is the goal on the next; this store
 * is the copy the screens read, kept across launches so the app opens on
 * the last known values rather than on defaults.
 *
 * Every change is shown at once and sent straight after. A change the server
 * refuses is put back by taking the server's copy again.
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => {
      // Never throws into the setter that called it: the change is already
      // on screen, and a save that fails is put right by the next read.
      const push = (patch: Partial<UserSettings>) => {
        Promise.resolve()
          .then(() => settingsApi.update(patch))
          .then(settings => set(fromServer(settings)))
          .catch(error => {
            logger.warn(
              'settingsStore',
              'Settings not saved',
              toApiError(error),
            );
            get().hydrateFromServer();
          });
      };

      return {
        ...DEFAULTS,

        setUnits: units => {
          set({ units });
          push({ units });
        },
        setDailyWaterGoalMl: ml => {
          const dailyWaterGoalMl = Math.max(
            500,
            Math.min(8000, Math.round(ml)),
          );
          set({ dailyWaterGoalMl });
          push({ dailyWaterGoalMl });
        },
        // Waited on rather than pushed: the goal screen closes on the
        // server's answer, and the range is the server's to check (⚙
        // `activity.goal`) — the screen keeps to the one it was given.
        saveDailyStepGoal: async steps => {
          const previous = get().dailyStepGoal;
          const dailyStepGoal = Math.round(steps);
          set({ dailyStepGoal });
          try {
            set(fromServer(await settingsApi.update({ dailyStepGoal })));
          } catch (error) {
            set({ dailyStepGoal: previous });
            throw error;
          }
        },
        setRestTimerSeconds: seconds => {
          const restTimerSeconds = Math.max(
            15,
            Math.min(600, Math.round(seconds)),
          );
          set({ restTimerSeconds });
          push({ restTimerSeconds });
        },
        toggleHaptics: () => {
          const hapticsEnabled = !get().hapticsEnabled;
          set({ hapticsEnabled });
          push({ hapticsEnabled });
        },
        toggleWorkoutReminders: () => {
          const workoutRemindersEnabled = !get().workoutRemindersEnabled;
          set({ workoutRemindersEnabled });
          push({ workoutRemindersEnabled });
        },
        toggleKeepAwake: () => {
          const keepAwakeDuringWorkout = !get().keepAwakeDuringWorkout;
          set({ keepAwakeDuringWorkout });
          push({ keepAwakeDuringWorkout });
        },

        hydrateFromServer: async () => {
          try {
            const settings = await settingsApi.get();
            set(fromServer(settings));
          } catch (error) {
            // Offline: the last known values stand until the next sync.
            logger.warn(
              'settingsStore',
              'Settings sync failed',
              toApiError(error),
            );
          }
        },

        reset: () => set(DEFAULTS),
      };
    },
    {
      name: 'vokve.settings',
      storage: createJSONStorage(() => mmkvStorage),
      version: 3,
      partialize: state => ({
        units: state.units,
        dailyStepGoal: state.dailyStepGoal,
        dailyWaterGoalMl: state.dailyWaterGoalMl,
        restTimerSeconds: state.restTimerSeconds,
        hapticsEnabled: state.hapticsEnabled,
        workoutRemindersEnabled: state.workoutRemindersEnabled,
        keepAwakeDuringWorkout: state.keepAwakeDuringWorkout,
        syncedAt: state.syncedAt,
      }),
    },
  ),
);

export const useUnits = () => useSettingsStore(s => s.units);
export const useDailyStepGoal = () => useSettingsStore(s => s.dailyStepGoal);
export const useDailyWaterGoalMl = () =>
  useSettingsStore(s => s.dailyWaterGoalMl);
