/**
 * How far this phone's clock is from the server's (RULES P17).
 *
 * A wrong clock on a step tracker is not a cosmetic fault. The day a walk
 * belongs to is decided on the phone's calendar, a reminder rings on the
 * phone's clock, and a snapshot older than the ingest window is refused —
 * so a phone an hour out produces three complaints that all look like
 * server bugs from the server. It is also the cheapest step fraud there is:
 * move the clock back and walk yesterday again.
 *
 * Measured from the `Date` header of replies the app was making anyway, so
 * it costs no request of its own. That header has one-second resolution and
 * the round trip adds a little more, which is why nothing here is reported
 * to the second — the question being asked is "is this phone minutes out",
 * and a couple of seconds of noise cannot change that answer.
 */

/** Below this, the difference is the network, not the clock. */
const NOISE_MS = 5_000;

let skewMs: number | null = null;
let measuredAt = 0;

/**
 * Records one reply's `Date` header.
 *
 * Takes the *newest* reading rather than averaging: a clock that was just
 * corrected should stop being reported as wrong on the next request, and an
 * average would carry the old fault for as long as it carried the new truth.
 */
export function noteServerTime(header: string | null | undefined, now = Date.now()): void {
  if (!header) return;
  const server = Date.parse(header);
  if (!Number.isFinite(server)) return;

  const difference = now - server;
  skewMs = Math.abs(difference) < NOISE_MS ? 0 : Math.round(difference);
  measuredAt = now;
}

/**
 * The phone's offset from the server, or null if no reply has been seen.
 *
 * Null rather than zero when nothing has been measured: "we have not asked"
 * and "the clock is right" are different answers, and a panel that drew the
 * first as the second would quietly vouch for every phone that had never
 * reached the server.
 */
export function clockSkewMs(): number | null {
  return measuredAt === 0 ? null : skewMs;
}

/** Only for tests, which cannot wait for a reply to arrive. */
export function resetClock(): void {
  skewMs = null;
  measuredAt = 0;
}
