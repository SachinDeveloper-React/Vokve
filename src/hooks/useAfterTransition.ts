import { useEffect, useState } from 'react';
import { whenIdle } from '../utils/idle';

/**
 * False until the screen has had a frame of its own.
 *
 * A tab press and the mount of the screen behind it compete for the same JS
 * thread, and the tab bar is what loses: the press lands, the bar waits for
 * the new screen's first commit, and on a mid-range Android that reads as a
 * frozen tab.
 *
 * So a screen whose content is expensive renders the cheap half of itself
 * first — a header, a search field, the shape of the page — and gates the
 * rest on this. The tab changes on a frame that costs nothing, and the work
 * happens once the thread is free (`whenIdle`, which is what React Native
 * points at now that `InteractionManager` is gone from its core).
 *
 * Deliberately one-way and once per mount: a screen that went back to "not
 * ready" would throw away a list the reader is already looking at, and the
 * second visit to a tab is cheap anyway — `freezeOnBlur` suspends the
 * screen rather than unmounting it.
 */
export function useAfterTransition(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return undefined;
    const idle = whenIdle(() => setReady(true));
    return () => idle.cancel();
  }, [ready]);

  return ready;
}
