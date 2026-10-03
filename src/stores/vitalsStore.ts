import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { vitalsApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { VitalKind, VitalReading } from '../types/models';
import { logger } from '../utils/logger';
import { uuid } from '../utils/uuid';
import { mmkvStorage } from './index';

/**
 * How many readings are kept on the device. The screens show a recent
 * history, not a medical record: everything older stays on the server.
 */
const MAX_READINGS = 60;

/** How old the readings may be before a screen coming into view asks again. */
export const VITALS_STALE_AFTER_MS = 5 * 60_000;

const byNewest = (a: VitalReading, b: VitalReading) =>
  b.recordedAt.localeCompare(a.recordedAt);

interface VitalsState {
  /** The server's newest readings of every entered kind; null until the first sync. */
  readings: VitalReading[] | null;
  /** The BMI the server derived from the newest weight and the height (RULES V3). */
  bmi: VitalReading | null;
  /** Readings logged here and not yet confirmed — persisted, so one logged offline is kept. */
  outbox: VitalReading[];
  /** When the server last confirmed a reading — the health score asks again on it. */
  confirmedAt: string | null;
  syncedAt: string | null;
  isSyncing: boolean;
  syncError: string | null;

  /** Sends what is waiting, then asks for the readings and the derived BMI. */
  hydrateFromServer: () => Promise<void>;
  refreshIfStale: () => Promise<void>;
  /**
   * Logs a reading — shown at once, sent in the background under its own id.
   * `secondary` is the diastolic half of a blood pressure. BMI is never
   * entered (RULES V1).
   */
  addReading: (
    kind: VitalKind,
    value: number,
    secondary?: number | null,
  ) => void;
  flush: () => Promise<void>;
  reset: () => void;
}

/** One flush at a time: two would send the same reading twice. */
let flushing: Promise<void> | null = null;

const isPermanent = (status: number | null) => status === 404 || status === 422;

/**
 * The vitals the user has logged, as the server holds them (RULES §V).
 *
 * One list for every kind rather than a field per vital: the screens show
 * the latest of each *and* a history of all of them, and a store shaped
 * around "current heart rate" would have to keep both, leaving the tile and
 * the row under it able to disagree. BMI is the server's, derived from the
 * newest weight and the profile's height — never typed in.
 */
export const useVitalsStore = create<VitalsState>()(
  persist(
    (set, get) => ({
      readings: null,
      bmi: null,
      outbox: [],
      confirmedAt: null,
      syncedAt: null,
      isSyncing: false,
      syncError: null,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true });
        await get().flush();
        try {
          const [readings, latest] = await Promise.all([
            vitalsApi.list({ limit: MAX_READINGS }),
            vitalsApi.latest(),
          ]);
          set({
            readings,
            bmi: latest.bmi,
            syncedAt: new Date().toISOString(),
            isSyncing: false,
            syncError: null,
          });
        } catch (error) {
          const apiError = toApiError(error);
          logger.warn('vitalsStore', 'Vitals sync failed', apiError);
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
        if (age < VITALS_STALE_AFTER_MS) {
          return;
        }
        await hydrateFromServer();
      },

      addReading: (kind, value, secondary = null) => {
        if (kind === 'bmi' || !Number.isFinite(value) || value <= 0) {
          return;
        }
        const reading: VitalReading = {
          id: uuid(),
          kind,
          value,
          secondary: kind === 'blood_pressure' ? secondary ?? null : null,
          recordedAt: new Date().toISOString(),
        };
        set(state => ({ outbox: [...state.outbox, reading] }));
        get().flush();
      },

      flush: () => {
        if (flushing) {
          return flushing;
        }
        flushing = (async () => {
          let sentWeight = false;
          try {
            for (;;) {
              const reading = get().outbox[0];
              if (reading === undefined) {
                return;
              }
              try {
                const saved = await vitalsApi.log(reading, {
                  idempotencyKey: `vital:${reading.id}`,
                });
                sentWeight = sentWeight || saved.kind === 'weight';
                set(state => ({
                  outbox: state.outbox.filter(entry => entry !== reading),
                  readings: [
                    saved,
                    ...(state.readings ?? []).filter(r => r.id !== saved.id),
                  ]
                    .sort(byNewest)
                    .slice(0, MAX_READINGS),
                  confirmedAt: new Date().toISOString(),
                  syncError: null,
                }));
              } catch (error) {
                const apiError = toApiError(error);
                if (!isPermanent(apiError.status)) {
                  set({ syncError: apiError.message });
                  return;
                }
                logger.warn('vitalsStore', 'A reading was refused', apiError);
                set(state => ({
                  outbox: state.outbox.filter(entry => entry !== reading),
                }));
              }
            }
          } finally {
            flushing = null;
            // A new weight is a new BMI, which is the server's to work out.
            if (sentWeight) {
              vitalsApi
                .latest()
                .then(latest => set({ bmi: latest.bmi }))
                .catch(() => {});
            }
          }
        })();
        return flushing;
      },

      reset: () =>
        set({
          readings: null,
          bmi: null,
          outbox: [],
          confirmedAt: null,
          syncedAt: null,
          isSyncing: false,
          syncError: null,
        }),
    }),
    {
      name: 'vokve.vitals',
      storage: createJSONStorage(() => mmkvStorage),
      // v2: the server's readings. A v1 store held seeded readings and ones
      // logged on the phone alone, and is dropped for the server's.
      version: 2,
      migrate: () => ({
        readings: null,
        bmi: null,
        outbox: [],
        confirmedAt: null,
        syncedAt: null,
      }),
      partialize: state => ({
        readings: state.readings,
        bmi: state.bmi,
        outbox: state.outbox,
        confirmedAt: state.confirmedAt,
        syncedAt: state.syncedAt,
      }),
    },
  ),
);

const NO_READINGS: VitalReading[] = [];

/**
 * Every reading the screens show, newest first: the server's, with the ones
 * still on their way. Memoised: a fresh array from a selector would never
 * compare equal and would re-render forever.
 */
export const useVitalReadings = (): VitalReading[] => {
  const readings = useVitalsStore(s => s.readings) ?? NO_READINGS;
  const outbox = useVitalsStore(s => s.outbox);
  return useMemo(() => {
    const known = new Set(readings.map(reading => reading.id));
    return [
      ...outbox.filter(reading => !known.has(reading.id)),
      ...readings,
    ].sort(byNewest);
  }, [outbox, readings]);
};

/** Whether the server has answered yet — the screens wait for it. */
export const useVitalsSynced = () => useVitalsStore(s => s.readings !== null);

/** The newest reading of each kind, which is what the tiles show; BMI is the server's. */
export const useLatestVitals = (): Partial<Record<VitalKind, VitalReading>> => {
  const readings = useVitalReadings();
  const bmi = useVitalsStore(s => s.bmi);

  return useMemo(() => {
    const latest: Partial<Record<VitalKind, VitalReading>> = {};
    for (const reading of readings) {
      const held = latest[reading.kind];
      if (held === undefined || reading.recordedAt > held.recordedAt) {
        latest[reading.kind] = reading;
      }
    }
    if (bmi) {
      latest.bmi = bmi;
    }
    return latest;
  }, [bmi, readings]);
};

/** One kind's readings, newest first. */
export const useReadingsOfKind = (
  kind: VitalKind,
  limit?: number,
): VitalReading[] => {
  const readings = useVitalReadings();

  return useMemo(() => {
    const ofKind = readings.filter(reading => reading.kind === kind);
    return limit === undefined ? ofKind : ofKind.slice(0, limit);
  }, [kind, limit, readings]);
};

/** The most recent readings across every kind, newest first. */
export const useRecentVitals = (limit: number): VitalReading[] => {
  const readings = useVitalReadings();
  return useMemo(() => readings.slice(0, limit), [limit, readings]);
};
