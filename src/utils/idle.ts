/**
 * Work that waits for the thread to be free.
 *
 * `InteractionManager` was the way to say this and was removed from React
 * Native's core in 0.87 — its getter now throws, pointing at
 * `requestIdleCallback` instead. So this is that, with the two things a
 * screen actually needs from it: a **timeout**, so the work still happens on
 * a thread that never goes idle, and a **cancel**, so a screen left during
 * its own transition does not run anything afterwards.
 *
 * The fallback is a plain macrotask. `requestIdleCallback` is one of React
 * Native's global polyfills rather than a language feature, so it is absent
 * under a bare test environment and on any runtime that has not installed
 * it — and "a tick later" is the whole promise here, which `setTimeout`
 * keeps.
 */

export interface Idle {
  cancel: () => void;
}

/** How long to wait for an idle moment before doing the work anyway. */
const TIMEOUT_MS = 300;

type IdleScheduler = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function whenIdle(run: () => void, timeout = TIMEOUT_MS): Idle {
  const scheduler = globalThis as unknown as IdleScheduler;

  if (typeof scheduler.requestIdleCallback === 'function') {
    const handle = scheduler.requestIdleCallback(run, { timeout });
    return {
      cancel: () => scheduler.cancelIdleCallback?.(handle),
    };
  }

  const timer = setTimeout(run, 0);
  return { cancel: () => clearTimeout(timer) };
}
