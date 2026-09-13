import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { seedVitals } from '../constants/seedData';
import type { VitalKind, VitalReading } from '../types/models';
import { mmkvStorage } from './index';

/**
 * How many readings are kept on the device. The screen shows a recent history,
 * not a medical record: everything older lives on the server once the health
 * service exists, and an unbounded array here would grow the persisted blob
 * for the life of the install.
 */
const MAX_READINGS = 60;

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const byNewest = (a: VitalReading, b: VitalReading) =>
  b.recordedAt.localeCompare(a.recordedAt);

interface VitalsState {
  /** Newest first. Capped at `MAX_READINGS`. */
  readings: VitalReading[];

  /** Logs a reading. `secondary` is the diastolic half of a blood pressure. */
  addReading: (
    kind: VitalKind,
    value: number,
    secondary?: number | null,
  ) => void;
  removeReading: (id: string) => void;
  reset: () => void;
}

/**
 * The vitals the user has logged.
 *
 * One list for every kind rather than a field per vital. The screen shows the
 * latest of each *and* a history of all of them, and a store shaped around
 * "current heart rate" would have to keep both, leaving the tile and the row
 * under it able to disagree.
 */
export const useVitalsStore = create<VitalsState>()(
  persist(
    set => ({
      readings: [...seedVitals].sort(byNewest),

      addReading: (kind, value, secondary = null) =>
        set(state => {
          if (!Number.isFinite(value) || value <= 0) {
            return state;
          }

          const entry: VitalReading = {
            id: createId(),
            kind,
            value,
            secondary: secondary ?? null,
            recordedAt: new Date().toISOString(),
          };

          return {
            readings: [entry, ...state.readings].slice(0, MAX_READINGS),
          };
        }),

      removeReading: id =>
        set(state => ({
          readings: state.readings.filter(reading => reading.id !== id),
        })),

      reset: () => set({ readings: [...seedVitals].sort(byNewest) }),
    }),
    {
      name: 'vokve.vitals',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
    },
  ),
);

export const useVitalReadings = () => useVitalsStore(s => s.readings);

/**
 * The newest reading of each kind, which is what the tiles show.
 *
 * Memoised over the list rather than derived in the selector: a fresh object
 * never compares equal to the last one, and the subscriber would re-render on
 * every store read.
 */
export const useLatestVitals = (): Partial<Record<VitalKind, VitalReading>> => {
  const readings = useVitalReadings();

  return useMemo(() => {
    const latest: Partial<Record<VitalKind, VitalReading>> = {};

    for (const reading of readings) {
      const held = latest[reading.kind];
      if (held === undefined || reading.recordedAt > held.recordedAt) {
        latest[reading.kind] = reading;
      }
    }

    return latest;
  }, [readings]);
};

/**
 * One kind's readings, newest first.
 *
 * Kept as its own selector rather than filtered at each call site: a vital's
 * own screen reads nothing else, and the memo means paging through a trend
 * does not re-filter the whole diary on every render.
 */
export const useReadingsOfKind = (
  kind: VitalKind,
  limit?: number,
): VitalReading[] => {
  const readings = useVitalReadings();

  return useMemo(() => {
    const ofKind = readings
      .filter(reading => reading.kind === kind)
      .sort(byNewest);
    return limit === undefined ? ofKind : ofKind.slice(0, limit);
  }, [kind, limit, readings]);
};

/** The most recent readings across every kind, newest first. */
export const useRecentVitals = (limit: number): VitalReading[] => {
  const readings = useVitalReadings();
  return useMemo(
    () => [...readings].sort(byNewest).slice(0, limit),
    [limit, readings],
  );
};
