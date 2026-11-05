import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

/**
 * How reachable this phone has been, kept between health reports (RULES P17).
 *
 * The server can see that an install has gone quiet. It cannot see why, and
 * "this phone had no signal all afternoon" and "this app is broken" are the
 * same silence from the other end — so support has been answering both the
 * same way. This is the phone answering it on the way back: how long it
 * spent unreachable, and whether it is unreachable now.
 *
 * `reachable: false` with a live interface is the one worth naming. A gym's
 * captive-portal wifi joins, reports a connection, and then swallows every
 * request; from the app's side it looks like a server that has stopped
 * answering, and it is the hardest support call there is to diagnose from
 * a description.
 *
 * The window is cumulative and is cleared only when a report is *accepted*,
 * so a report that itself failed to send does not throw away the very
 * evidence that explains why.
 */

interface Window {
  /** Milliseconds offline since the window opened. */
  offlineMs: number;
  /** Set while it is offline now, so an open stretch can still be counted. */
  offlineSince: number | null;
  type: string | null;
  reachable: boolean | null;
}

const empty = (): Window => ({ offlineMs: 0, offlineSince: null, type: null, reachable: null });

let window = empty();
let stop: (() => void) | null = null;

/** Offline is declared only on an explicit refusal — see `useNetworkStatus`. */
function isOffline(state: NetInfoState): boolean {
  return !(state.isConnected ?? false) || state.isInternetReachable === false;
}

function apply(state: NetInfoState, now = Date.now()): void {
  window.type = state.type ?? null;
  window.reachable = state.isInternetReachable;

  const offline = isOffline(state);
  if (offline && window.offlineSince === null) {
    window.offlineSince = now;
    return;
  }
  if (!offline && window.offlineSince !== null) {
    window.offlineMs += Math.max(0, now - window.offlineSince);
    window.offlineSince = null;
  }
}

/**
 * Starts watching. Idempotent, and safe to call before the first state
 * arrives: a phone that has never reported says `null`, not "online".
 */
export function startConnectivityWatch(): () => void {
  if (stop) return stop;
  const unsubscribe = NetInfo.addEventListener(state => apply(state));
  stop = () => {
    unsubscribe();
    stop = null;
  };
  return stop;
}

export interface ConnectivitySnapshot {
  type: string | null;
  reachable: boolean | null;
  offlineMs: number;
  offlineSince: string | null;
}

/**
 * The window so far, including the stretch it is in the middle of.
 *
 * An open stretch is counted but not closed: a phone that has been offline
 * for three hours and is still offline has to be able to say so the moment
 * it gets a signal back, and that is exactly the report that would
 * otherwise carry a zero.
 */
export function connectivitySnapshot(now = Date.now()): ConnectivitySnapshot {
  const open = window.offlineSince === null ? 0 : Math.max(0, now - window.offlineSince);
  return {
    type: window.type,
    reachable: window.reachable,
    offlineMs: window.offlineMs + open,
    offlineSince: window.offlineSince === null ? null : new Date(window.offlineSince).toISOString(),
  };
}

/**
 * Clears the counted time, keeping the state it is in.
 *
 * Called once a report has been accepted. A stretch still open is restarted
 * from now rather than dropped, so the next report counts the rest of it
 * instead of counting it twice.
 */
export function clearConnectivityWindow(now = Date.now()): void {
  window = {
    offlineMs: 0,
    offlineSince: window.offlineSince === null ? null : now,
    type: window.type,
    reachable: window.reachable,
  };
}

/** Only for tests: drives the watcher without a real network. */
export const connectivityInternals = {
  apply,
  reset: () => {
    window = empty();
  },
};
