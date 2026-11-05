/**
 * The two signals the phone keeps for itself between reports (RULES P17).
 *
 * Both exist to answer a question the server cannot: why an install went
 * quiet, and whether the clock its days are counted on can be trusted. Both
 * are therefore judged on what they say when they do *not* know — a clock
 * never measured must not read as a clock that is right, and a phone that
 * has never reported its network must not read as online.
 *
 * @format
 */

import {
  clearConnectivityWindow,
  connectivityInternals,
  connectivitySnapshot,
} from '../src/services/connectivity';
import { clockSkewMs, noteServerTime, resetClock } from '../src/services/clock';

const AT = Date.parse('2026-11-05T10:00:00.000Z');

/** What NetInfo hands a listener, narrowed to the parts this reads. */
const state = (over: Record<string, unknown> = {}) =>
  ({
    type: 'wifi',
    isConnected: true,
    isInternetReachable: true,
    ...over,
  }) as never;

beforeEach(() => {
  resetClock();
  connectivityInternals.reset();
});

describe('the phone’s clock against the server’s', () => {
  test('nothing measured is null, not zero', () => {
    // "We have not asked" and "the clock is right" are different answers,
    // and reporting the first as the second would vouch for every phone
    // that has never reached the server.
    expect(clockSkewMs()).toBeNull();
  });

  test('a difference inside the round trip is not a skew', () => {
    noteServerTime(new Date(AT - 2_000).toUTCString(), AT);
    expect(clockSkewMs()).toBe(0);
  });

  test('a phone minutes out says so, and says which way', () => {
    noteServerTime(new Date(AT - 15 * 60_000).toUTCString(), AT);
    expect(clockSkewMs()).toBe(15 * 60_000); // ahead

    noteServerTime(new Date(AT + 15 * 60_000).toUTCString(), AT);
    expect(clockSkewMs()).toBe(-15 * 60_000); // behind
  });

  test('a corrected clock stops being reported as wrong at once', () => {
    noteServerTime(new Date(AT - 3_600_000).toUTCString(), AT);
    expect(clockSkewMs()).not.toBe(0);

    // The newest reading wins rather than an average, which would carry the
    // old fault for as long as it carried the new truth.
    noteServerTime(new Date(AT).toUTCString(), AT);
    expect(clockSkewMs()).toBe(0);
  });

  test('a header that is not a date is ignored rather than guessed at', () => {
    noteServerTime('not a date', AT);
    expect(clockSkewMs()).toBeNull();
    noteServerTime(undefined, AT);
    expect(clockSkewMs()).toBeNull();
  });
});

describe('how reachable the phone has been', () => {
  test('before anything is known it claims neither online nor offline', () => {
    const snapshot = connectivitySnapshot(AT);
    expect(snapshot.reachable).toBeNull();
    expect(snapshot.offlineMs).toBe(0);
  });

  test('a closed stretch is counted once', () => {
    connectivityInternals.apply(state({ isConnected: false }), AT);
    connectivityInternals.apply(state(), AT + 90_000);

    const snapshot = connectivitySnapshot(AT + 120_000);
    expect(snapshot.offlineMs).toBe(90_000);
    expect(snapshot.offlineSince).toBeNull();
  });

  test('a stretch still open is counted without being closed', () => {
    // The phone that has been offline for three hours and still is has to
    // be able to say so the moment it gets a signal back — that is exactly
    // the report that would otherwise carry a zero.
    connectivityInternals.apply(state({ isConnected: false }), AT);

    const snapshot = connectivitySnapshot(AT + 3 * 3_600_000);
    expect(snapshot.offlineMs).toBe(3 * 3_600_000);
    expect(snapshot.offlineSince).toBe(new Date(AT).toISOString());
  });

  test('a captive portal counts as offline, because every request fails', () => {
    // A gym's wifi joins, reports a connection, and swallows everything.
    connectivityInternals.apply(
      state({ isConnected: true, isInternetReachable: false }),
      AT,
    );

    const snapshot = connectivitySnapshot(AT + 60_000);
    expect(snapshot.offlineMs).toBe(60_000);
    expect(snapshot.reachable).toBe(false);
  });

  test('clearing the window restarts an open stretch rather than dropping it', () => {
    connectivityInternals.apply(state({ isConnected: false }), AT);
    clearConnectivityWindow(AT + 60_000);

    // The minute already reported is gone; the stretch it is still in is
    // counted from the clearing, so the next report does not count it twice.
    const snapshot = connectivitySnapshot(AT + 90_000);
    expect(snapshot.offlineMs).toBe(30_000);
    expect(snapshot.offlineSince).toBe(new Date(AT + 60_000).toISOString());
  });

  test('a window cleared while online stays empty', () => {
    connectivityInternals.apply(state({ isConnected: false }), AT);
    connectivityInternals.apply(state(), AT + 60_000);
    clearConnectivityWindow(AT + 60_000);

    expect(connectivitySnapshot(AT + 120_000).offlineMs).toBe(0);
  });
});
