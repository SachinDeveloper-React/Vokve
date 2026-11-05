import { env } from '../config/env.js';
import { getKV } from '../db/redis.js';
import { isEmailConfigured, sendOperationalEmail } from './mail.js';
import { logger } from './logger.js';

export type AlertSeverity = 'warning' | 'critical';

export interface Alert {
  /**
   * What is wrong, as a stable key. It is the cooldown's identity, so it
   * must not carry a figure in it — `errors.spike:1.4.0` is one alarm that
   * quietens for an hour, while `errors.spike:1.4.0:412` would be a new
   * alarm every time the count moved.
   */
  key: string;
  severity: AlertSeverity;
  title: string;
  /** One line each, in the order a reader needs them. */
  lines: string[];
  /** Where to go and look. Relative to the panel. */
  path?: string;
}

/** How long one key stays quiet after it has been raised. */
const COOLDOWN_SECONDS = 3600;

const ICON: Record<AlertSeverity, string> = { warning: '⚠️', critical: '🚨' };

/**
 * Tells somebody the fleet is unwell (RULES P17).
 *
 * Everything this server knows about a broken release was already on a
 * dashboard; what was missing is that a dashboard has to be opened. A step
 * tracker that stops counting on one OEM does not announce itself — the
 * members simply walk, lose their days, and some fraction of them leave. By
 * the time support hears it in words it has been true for a week.
 *
 * Deliberately one function with its own cooldown rather than a channel each
 * caller wires itself: an alarm that fires every hour is an alarm people
 * learn to ignore, and that is a worse state than having none.
 *
 * Never throws. A webhook that is down is not a reason to fail the job that
 * noticed the problem — the problem is still in the panel, and the log still
 * carries the line.
 */
export async function raiseAlert(alert: Alert): Promise<boolean> {
  const quiet = !(await getKV().setIfAbsent(`alerts:${alert.key}`, COOLDOWN_SECONDS));
  if (quiet) return false;

  const body = [`${ICON[alert.severity]} *${alert.title}*`, ...alert.lines]
    .concat(alert.path ? [`Panel: ${alert.path}`] : [])
    .join('\n');

  logger.warn({ key: alert.key, severity: alert.severity, lines: alert.lines }, 'alerts.raised');

  await Promise.allSettled([postWebhook(body), postEmail(alert, body)]);
  return true;
}

async function postWebhook(text: string): Promise<void> {
  if (!env.OPS_WEBHOOK_URL) return;
  try {
    // Bounded, because this runs inside an hourly job that has other checks
    // to make and a webhook host that hangs must not take them down with it.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(env.OPS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, 'alerts.webhook_refused');
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    logger.warn({ err: error }, 'alerts.webhook_unreachable');
  }
}

async function postEmail(alert: Alert, body: string): Promise<void> {
  if (!env.OPS_EMAIL || !isEmailConfigured()) return;
  try {
    await sendOperationalEmail(env.OPS_EMAIL, `[Vokve ${alert.severity}] ${alert.title}`, body);
  } catch (error) {
    logger.warn({ err: error }, 'alerts.email_failed');
  }
}
