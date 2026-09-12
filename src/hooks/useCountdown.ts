import { useCallback, useEffect, useRef, useState } from 'react';

const TICK_MS = 1000;

export interface Countdown {
  /** Whole seconds remaining, never below zero. */
  secondsLeft: number;
  isFinished: boolean;
  /** Starts again from `seconds`, or from the original duration. */
  restart: (seconds?: number) => void;
}

/**
 * A once-per-second countdown.
 *
 * Counts down to a deadline rather than decrementing a number on each tick.
 * Timers do not fire while the app is backgrounded, so a decrementing counter
 * comes back showing whatever it was when the user left — an OTP that claims
 * two minutes of life after five minutes away is worse than no timer at all.
 * A deadline is simply re-read, so returning to the app shows the truth.
 *
 * Pass `null` to hold the countdown idle — a screen that has not yet been told
 * how long it has, for instance.
 */
export function useCountdown(seconds: number | null): Countdown {
  const deadline = useRef<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(() => seconds ?? 0);

  const remaining = useCallback(() => {
    if (deadline.current === null) {
      return 0;
    }
    return Math.max(0, Math.ceil((deadline.current - Date.now()) / TICK_MS));
  }, []);

  const restart = useCallback(
    (next?: number) => {
      const duration = next ?? seconds;
      if (duration === null || duration === undefined) {
        return;
      }
      deadline.current = Date.now() + duration * TICK_MS;
      setSecondsLeft(duration);
    },
    [seconds],
  );

  useEffect(() => {
    if (seconds === null) {
      deadline.current = null;
      setSecondsLeft(0);
      return;
    }

    deadline.current = Date.now() + seconds * TICK_MS;
    setSecondsLeft(seconds);
  }, [seconds]);

  useEffect(() => {
    if (secondsLeft <= 0) {
      return;
    }

    const interval = setInterval(() => {
      const left = remaining();
      setSecondsLeft(left);
      if (left <= 0) {
        clearInterval(interval);
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [secondsLeft, remaining]);

  return { secondsLeft, isFinished: secondsLeft <= 0, restart };
}
