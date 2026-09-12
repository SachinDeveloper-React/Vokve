import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { UnitSystem } from '../types/models';
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

  setUnits: (units: UnitSystem) => void;
  setDailyStepGoal: (steps: number) => void;
  setDailyWaterGoalMl: (ml: number) => void;
  setRestTimerSeconds: (seconds: number) => void;
  toggleHaptics: () => void;
  toggleWorkoutReminders: () => void;
  toggleKeepAwake: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    set => ({
      units: 'metric',
      dailyStepGoal: 10000,
      dailyWaterGoalMl: 2500,
      restTimerSeconds: 90,
      hapticsEnabled: true,
      workoutRemindersEnabled: true,
      keepAwakeDuringWorkout: true,

      setUnits: units => set({ units }),
      setDailyWaterGoalMl: ml =>
        set({ dailyWaterGoalMl: Math.max(500, Math.min(8000, Math.round(ml))) }),
      setDailyStepGoal: steps =>
        // Clamped to a range a person can actually walk in a day.
        set({ dailyStepGoal: Math.max(1000, Math.min(50000, Math.round(steps))) }),
      setRestTimerSeconds: seconds =>
        set({ restTimerSeconds: Math.max(15, Math.min(600, seconds)) }),
      toggleHaptics: () => set(s => ({ hapticsEnabled: !s.hapticsEnabled })),
      toggleWorkoutReminders: () =>
        set(s => ({ workoutRemindersEnabled: !s.workoutRemindersEnabled })),
      toggleKeepAwake: () =>
        set(s => ({ keepAwakeDuringWorkout: !s.keepAwakeDuringWorkout })),
    }),
    {
      name: 'vokve.settings',
      storage: createJSONStorage(() => mmkvStorage),
      version: 3,
    },
  ),
);

export const useUnits = () => useSettingsStore(s => s.units);
export const useDailyStepGoal = () => useSettingsStore(s => s.dailyStepGoal);
export const useDailyWaterGoalMl = () =>
  useSettingsStore(s => s.dailyWaterGoalMl);
