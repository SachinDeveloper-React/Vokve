import type { Request } from 'express';
import { getKV } from '../db/redis.js';
import { isAlertQuiet, raiseAlert } from './alerts.js';

/**
 * Telling somebody the server threw, the first time it does (RULES P20).
 *
 * A 500 is the one answer that is always our fault: every refusal the API
 * means to give is an `ApiError` with its own status. Until this, a 500 was
 * one line in a log kept for hours — a route that failed every member who
 * opened a screen looked, from the outside, exactly like a quiet day.
 *
 * One alarm per route and error name, then quiet for an hour, so a broken
 * screen is one message rather than one a request. And at most
 * `ALERTS_PER_HOUR` distinct ones in an hour: when the database goes, every
 * route fails at once, and thirty messages say less than the first five and
 * a line saying there are more.
 */
const ALERTS_PER_HOUR = 5;

function firstOwnFrame(stack: string | undefined): string | undefined {
  const frames = (stack ?? '').split('\n').slice(1).map(l => l.trim());
  const own = frames.find(l => l.includes('/src/') && !l.includes('node_modules')) ?? frames[0];
  return own?.replace(/^at /, '').replace(/\(?\/.*\/src\//, '(src/').slice(0, 200);
}

/** Never throws, and never holds the answer up for longer than the channels' own bound. */
export async function alertUnexpectedError(req: Request, error: unknown): Promise<void> {
  try {
    // A library error that carries a 4xx (a client hanging up mid-upload,
    // a body in an encoding nobody accepts) is the caller's doing, not ours.
    const status = (error as { status?: unknown; statusCode?: unknown } | null)?.status
      ?? (error as { statusCode?: unknown } | null)?.statusCode;
    if (typeof status === 'number' && status < 500) return;

    const err = error instanceof Error ? error : new Error(String(error));
    const route = (req.route as { path?: string } | undefined)?.path ?? '(before any route)';
    const key = `server.error:${req.method} ${route}:${err.name}`;
    if (await isAlertQuiet(key)) return;

    let spent: number;
    try {
      spent = await getKV().incrWithTtl('alerts:server.error:budget', 3600);
    } catch {
      spent = 1;
    }
    if (spent > ALERTS_PER_HOUR + 1) return;
    if (spent === ALERTS_PER_HOUR + 1) {
      await raiseAlert({
        key: 'server.error:many',
        severity: 'critical',
        title: 'The server is failing in many places at once',
        lines: [
          `More than ${ALERTS_PER_HOUR} different errors in the last hour; no more will be sent until it passes.`,
          'Usually the database or Redis. Check /v1/health and the log for level "error".',
        ],
      });
      return;
    }

    const ctx = req.ctx;
    await raiseAlert({
      key,
      severity: 'critical',
      title: `Server error on ${req.method} ${route}`,
      lines: [
        `${err.name}: ${err.message.slice(0, 300)}`,
        ...(firstOwnFrame(err.stack) ? [`At ${firstOwnFrame(err.stack)}`] : []),
        `Request ${ctx?.requestId ?? '?'} — ${req.method} ${req.path}${ctx?.appVersion ? `, app ${ctx.platform ?? ''} ${ctx.appVersion}` : ''}.`,
        'The member got "Something went wrong". More of the same stay quiet for an hour; search the log for the request id.',
      ],
    });
  } catch {
    // An alarm that cannot be raised must not turn a 500 into a hung request.
  }
}
