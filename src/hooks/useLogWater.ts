import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/feedback';
import { checkWaterAdd } from '../services/hydrationGuard';
import {
  useHydrationStore,
  useTodayHydrationView,
  useWaterLimits,
} from '../stores/hydrationStore';

/**
 * Logging a drink, with the server's limits applied first (RULES Y1b).
 *
 * One hook rather than one screen's handler, because water is logged from
 * two places — the dashboard's hydration card and the water screen itself —
 * and a guard that lived on the screen would be a guard the dashboard walked
 * straight past. That is not a hypothetical: it is where the bug was.
 *
 * What it does, in order:
 *
 *  - refuses what cannot be logged, and says why and what is left;
 *  - asks about a drink that is believable but unusual, and logs it unchanged
 *    if the user says yes;
 *  - reports a drink the *server* refused, which the client's own check
 *    cannot always foresee — a second phone logging into the same day, or a
 *    ceiling moved since this app last read it.
 *
 * The question is state rather than a dialog call, because a hook cannot
 * render: whoever uses it draws `<WaterGuardSheet>` with what comes back.
 */
export interface LogWater {
  /** Logs a drink, asking or refusing first where the limits say to. */
  logWater: (ml: number) => void;
  /** The open question, or null. Drawn by `WaterGuardSheet`. */
  question: { title: string; message: string } | null;
  /** Logs the drink the question is about. */
  confirm: () => void;
  /** Drops it. */
  dismiss: () => void;
}

export function useLogWater(): LogWater {
  const today = useTodayHydrationView();
  const limits = useWaterLimits();
  const add = useHydrationStore(s => s.add);
  const refusal = useHydrationStore(s => s.refusal);
  const clearRefusal = useHydrationStore(s => s.clearRefusal);
  const toast = useToast();

  const [pendingMl, setPendingMl] = useState<number | null>(null);
  const [question, setQuestion] = useState<LogWater['question']>(null);

  /**
   * A drink the server refused for good — the day's ceiling, almost always.
   *
   * Told once, and left on screen until dismissed: the user watched the
   * figure go up and it is about to come back down, and a number moving on
   * its own with no explanation is worse than the refusal itself.
   */
  useEffect(() => {
    if (refusal === null) {
      return;
    }
    toast.show({
      title: 'That drink was not logged',
      message: refusal,
      tone: 'warning',
      durationMs: 0,
    });
    clearRefusal();
  }, [clearRefusal, refusal, toast]);

  const logWater = useCallback(
    (ml: number) => {
      // Before the first answer there are no limits to check against, and
      // guessing one would risk refusing a drink the server would take. The
      // server is still the authority either way.
      if (limits === null) {
        add(ml);
        return;
      }

      const verdict = checkWaterAdd(ml, {
        consumedMl: today.consumedMl,
        entries: today.entries,
        limits,
      });

      if (verdict.kind === 'ok') {
        add(ml);
        return;
      }
      if (verdict.kind === 'refuse') {
        toast.show({
          title: verdict.title,
          message: verdict.message,
          tone: 'warning',
          durationMs: 0,
        });
        return;
      }
      setPendingMl(ml);
      setQuestion({ title: verdict.title, message: verdict.message });
    },
    [add, limits, today.consumedMl, today.entries, toast],
  );

  const dismiss = useCallback(() => {
    setPendingMl(null);
    setQuestion(null);
  }, []);

  const confirm = useCallback(() => {
    if (pendingMl !== null) {
      add(pendingMl);
    }
    dismiss();
  }, [add, dismiss, pendingMl]);

  return useMemo(
    () => ({ logWater, question, confirm, dismiss }),
    [confirm, dismiss, logWater, question],
  );
}
