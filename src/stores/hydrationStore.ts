import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { hydrationApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { HydrationDay, HydrationEntry } from '../types/models';
import { todayIso } from '../utils/date';
import { logger } from '../utils/logger';
import { uuid } from '../utils/uuid';
import { mmkvStorage } from './index';

/** How old today's figures may be before a screen coming into view asks again. */
export const HYDRATION_STALE_AFTER_MS = 60_000;

/** A drink logged or taken back here that the server has not confirmed yet. */
export type HydrationChange =
  | { kind: 'add'; entry: HydrationEntry }
  | { kind: 'remove'; id: string };

interface HydrationState {
  /** The server's last answer about the day; null until the first. */
  day: HydrationDay | null;
  /** Changes waiting for the server, oldest first. Persisted, so a drink logged offline is not lost. */
  outbox: HydrationChange[];
  syncedAt: string | null;
  isSyncing: boolean;
  /** Why the last exchange failed; cleared by the next that succeeds. */
  syncError: string | null;
  /**
   * A change the server refused for good (RULES Y1b) — a day past its
   * ceiling, most often — worded for the user, until they have been told.
   *
   * Kept apart from `syncError`, which is about the network and resolves
   * itself. This will not: the drink is gone and the user has to know why,
   * or the figure they watched appear and vanish is unexplained. Cleared by
   * `clearRefusal` once a screen has said it.
   */
  refusal: string | null;

  /** Sends what is waiting, then asks for today. Resolves either way. */
  hydrateFromServer: () => Promise<void>;
  refreshIfStale: () => Promise<void>;
  /** Logs a drink now. It shows at once and is sent in the background. */
  add: (ml: number) => void;
  /** Takes a logged drink back out. */
  remove: (id: string) => void;
  /** Sends the waiting changes in order; stops at the first that cannot go yet. */
  flush: () => Promise<void>;
  /** Marks the last refusal as told. */
  clearRefusal: () => void;
  reset: () => void;
}

/** One flush at a time, whoever asks: two would send the same drink twice. */
let flushing: Promise<void> | null = null;

/** A refusal that sending again cannot change: the drink is not the server's to take, or never was. */
const isPermanent = (status: number | null) => status === 404 || status === 422;

/**
 * Water, as the server counts it (RULES §Y).
 *
 * A cache of `GET /hydration/today` plus an outbox. A tap on a quick-add
 * goes into the outbox and shows at once; the outbox is sent in order — each
 * drink with its own id, so a retry is the same glass — and every answer
 * replaces the cached day. The total on screen is the server's day with the
 * changes still on their way laid over it, so it never waits for a network
 * and never disagrees with the log under it.
 */
export const useHydrationStore = create<HydrationState>()(
  persist(
    (set, get) => ({
      day: null,
      outbox: [],
      syncedAt: null,
      isSyncing: false,
      syncError: null,
      refusal: null,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true });
        await get().flush();
        try {
          const day = await hydrationApi.today();
          set({
            day,
            syncedAt: new Date().toISOString(),
            isSyncing: false,
            syncError: null,
          });
        } catch (error) {
          const apiError = toApiError(error);
          logger.warn('hydrationStore', 'Water sync failed', apiError);
          set({ isSyncing: false, syncError: apiError.message });
        }
      },

      refreshIfStale: async () => {
        const { syncedAt, isSyncing, day, hydrateFromServer } = get();
        if (isSyncing) {
          return;
        }
        const age = syncedAt
          ? Date.now() - new Date(syncedAt).getTime()
          : Infinity;
        // A day that has rolled over is stale whatever its age.
        if (age < HYDRATION_STALE_AFTER_MS && day?.date === todayIso()) {
          return;
        }
        await hydrateFromServer();
      },

      add: ml => {
        const amount = Math.round(ml);
        if (amount <= 0) {
          return;
        }
        const entry: HydrationEntry = {
          id: uuid(),
          ml: amount,
          at: new Date().toISOString(),
        };
        set(state => ({ outbox: [...state.outbox, { kind: 'add', entry }] }));
        get().flush();
      },

      remove: id => {
        set(state => {
          // A drink still waiting to go is simply not sent.
          const queued = state.outbox.findIndex(
            change => change.kind === 'add' && change.entry.id === id,
          );
          if (queued > 0 || (queued === 0 && flushing === null)) {
            return {
              outbox: state.outbox.filter((_, index) => index !== queued),
            };
          }
          return { outbox: [...state.outbox, { kind: 'remove', id }] };
        });
        get().flush();
      },

      flush: () => {
        if (flushing) {
          return flushing;
        }
        flushing = (async () => {
          try {
            for (;;) {
              const change = get().outbox[0];
              if (change === undefined) {
                return;
              }
              try {
                const day =
                  change.kind === 'add'
                    ? await hydrationApi.log(change.entry, {
                        idempotencyKey: `drink:${change.entry.id}`,
                      })
                    : await hydrationApi.remove(change.id, {
                        idempotencyKey: `drink-remove:${change.id}`,
                      });
                set(state => ({
                  outbox: state.outbox.filter(entry => entry !== change),
                  // An answer about another day — a drink logged just
                  // before midnight — does not replace today's.
                  day:
                    day.date === todayIso() || state.day === null
                      ? day
                      : state.day,
                  syncedAt: new Date().toISOString(),
                  syncError: null,
                }));
              } catch (error) {
                const apiError = toApiError(error);
                if (!isPermanent(apiError.status)) {
                  // No connection, or the server is busy: everything waits
                  // for the next chance, in the same order.
                  set({ syncError: apiError.message });
                  return;
                }
                logger.warn(
                  'hydrationStore',
                  'A water change was refused',
                  apiError,
                );
                set(state => ({
                  outbox: state.outbox.filter(entry => entry !== change),
                  // Told rather than swallowed: the user watched this drink
                  // appear, and it is about to vanish. Only for a drink
                  // being added — a delete the server has already forgotten
                  // is nothing the user needs to hear about.
                  refusal:
                    change.kind === 'add' ? apiError.message : state.refusal,
                }));
              }
            }
          } finally {
            flushing = null;
          }
        })();
        return flushing;
      },

      clearRefusal: () => {
        if (get().refusal !== null) {
          set({ refusal: null });
        }
      },

      reset: () =>
        set({
          day: null,
          outbox: [],
          syncedAt: null,
          isSyncing: false,
          syncError: null,
          refusal: null,
        }),
    }),
    {
      name: 'vokve.hydration',
      storage: createJSONStorage(() => mmkvStorage),
      // v3: the server's day and an outbox. A v2 store held today's drinks
      // on the phone alone; today's are sent on as if just logged, older
      // ones were already only the phone's and go.
      version: 3,
      migrate: (persisted, version) => {
        const stored = persisted as {
          date?: string;
          entries?: HydrationEntry[];
        } | null;
        if (version < 3 && stored?.date === todayIso() && stored.entries) {
          return {
            day: null,
            outbox: stored.entries
              .slice()
              .reverse()
              .map(entry => ({ kind: 'add' as const, entry })),
            syncedAt: null,
          };
        }
        return version < 3
          ? { day: null, outbox: [], syncedAt: null }
          : (persisted as object);
      },
      partialize: state => ({
        day: state.day,
        outbox: state.outbox,
        syncedAt: state.syncedAt,
      }),
    },
  ),
);

export interface HydrationToday {
  /** Null until the server has answered for today. */
  synced: boolean;
  consumedMl: number;
  /** Newest first: the server's drinks less those being taken back, and the ones on their way. */
  entries: HydrationEntry[];
}

/**
 * Today as the screens show it: the server's day — when it is today's —
 * with the outbox laid over it. Derived with `useMemo`: a fresh object from
 * a selector would never compare equal and would re-render forever.
 */
export const useTodayHydrationView = (): HydrationToday => {
  const day = useHydrationStore(s => s.day);
  const outbox = useHydrationStore(s => s.outbox);
  return useMemo(() => {
    const today = todayIso();
    const base = day?.date === today ? day.entries : [];
    const removed = new Set(
      outbox.flatMap(change => (change.kind === 'remove' ? [change.id] : [])),
    );
    const known = new Set(base.map(entry => entry.id));
    const todayLocal = new Date().toDateString();
    const pending = outbox.flatMap(change =>
      change.kind === 'add' &&
      !known.has(change.entry.id) &&
      new Date(change.entry.at).toDateString() === todayLocal
        ? [change.entry]
        : [],
    );
    const entries = [...pending, ...base]
      .filter(entry => !removed.has(entry.id))
      .sort((a, b) => b.at.localeCompare(a.at));
    return {
      synced: day?.date === today,
      consumedMl: entries.reduce((sum, entry) => sum + entry.ml, 0),
      entries,
    };
  }, [day, outbox]);
};

/**
 * The limits the server sent with the day (RULES Y1b), or null before the
 * first answer.
 *
 * Null rather than a built-in default on purpose: an app that guessed a
 * ceiling would go on enforcing a number the server has moved, and a guess
 * that is too low would refuse a drink the server would have taken. With no
 * answer yet there is nothing to check against, and the server still is.
 */
export const useWaterLimits = () =>
  useHydrationStore(s => s.day?.limits ?? null);

/** The server's health note about today, or null — which is most days. */
export const useWaterCaution = () =>
  useHydrationStore(s => s.day?.caution ?? null);

/** Millilitres today — the server's, with this phone's unsent drinks added. */
export const useTodayHydration = (): number =>
  useTodayHydrationView().consumedMl;

/** Today's drinks, newest first. */
export const useTodayHydrationEntries = (): HydrationEntry[] =>
  useTodayHydrationView().entries;
