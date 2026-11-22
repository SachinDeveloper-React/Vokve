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
  /**
   * Leave the email channel out. For alarms about the SMTP account itself
   * (RULES P20): the ops email goes out through it, so it would fail with
   * the very fault it is reporting — and spend a further SMTP timeout on a
   * request that has already waited out one.
   */
  skipEmail?: boolean;
}

/** How long one key stays quiet after it has been raised. */
const COOLDOWN_SECONDS = 3600;

/**
 * How long a channel may take. Short, because an alarm can now be raised
 * from inside a request (RULES P20) — a failed OTP mail, a 500 — and that
 * request is still waiting to be answered.
 */
const CHANNEL_TIMEOUT_MS = 5_000;

/** Discord refuses a message over 2000 characters, Telegram over 4096. */
const MAX_TEXT = 1900;

/**
 * The cooldown when the KV cannot be reached — a Redis outage is exactly
 * when alarms fire, and an unreachable cooldown must neither silence them
 * nor let them fire on every request. Per process, so a fleet of instances
 * may each send once; that is the better of the two failures.
 */
const localCooldown = new Map<string, number>();

async function claimCooldown(key: string): Promise<boolean> {
  try {
    return await getKV().setIfAbsent(`alerts:${key}`, COOLDOWN_SECONDS);
  } catch {
    const now = Date.now();
    const until = localCooldown.get(key);
    if (until && until > now) return false;
    localCooldown.set(key, now + COOLDOWN_SECONDS * 1000);
    return true;
  }
}

/** Whether `key` was raised within the last hour, without claiming it. */
export async function isAlertQuiet(key: string): Promise<boolean> {
  try {
    return await getKV().has(`alerts:${key}`);
  } catch {
    return (localCooldown.get(key) ?? 0) > Date.now();
  }
}

/** The channels configured, for the boot banner. */
export function alertChannels(): string[] {
  return [
    ...(env.OPS_TELEGRAM_BOT_TOKEN && env.OPS_TELEGRAM_CHAT_ID ? ['telegram'] : []),
    ...(env.OPS_WEBHOOK_URL ? ['webhook'] : []),
    ...(env.OPS_EMAIL && isEmailConfigured() ? ['email'] : []),
  ];
}

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
  if (!(await claimCooldown(alert.key))) return false;

  // A laptop's alarm says so, so nobody gets up for a developer's test run.
  const where = env.NODE_ENV === 'production' ? '' : ` [${env.NODE_ENV}]`;
  const body = [`${ICON[alert.severity]} ${alert.title}${where}`, ...alert.lines]
    .concat(alert.path ? [`Panel: ${alert.path}`] : [])
    .join('\n')
    .slice(0, MAX_TEXT);

  logger.warn({ key: alert.key, severity: alert.severity, lines: alert.lines }, 'alerts.raised');

  await Promise.allSettled([
    postWebhook(body),
    postTelegram(body),
    // nodemailer's own timeouts add up to twenty seconds and more; stop
    // waiting at the same bound as the others and let it finish on its own.
    alert.skipEmail ? Promise.resolve() : Promise.race([postEmail(alert, body), sleep(CHANNEL_TIMEOUT_MS)]),
  ]);
  return true;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms).unref());

/**
 * One bounded POST. A host that hangs must not hold up the hourly job that
 * noticed the problem, nor the member's request that hit it.
 */
async function post(channel: string, url: string, payload: unknown): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHANNEL_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn({ channel, status: response.status }, 'alerts.channel_refused');
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    // The error only — never the URL, which for Telegram carries the bot token.
    logger.warn({ channel, reason: error instanceof Error ? error.message : String(error) }, 'alerts.channel_unreachable');
  }
}

/**
 * `text` for Slack and Google Chat, `content` for Discord. Each ignores the
 * other's field, so one URL works whichever of them it points at.
 */
async function postWebhook(text: string): Promise<void> {
  if (!env.OPS_WEBHOOK_URL) return;
  await post('webhook', env.OPS_WEBHOOK_URL, { text, content: text });
}

/** Plain text, no `parse_mode`: a stray `_` in an error message must not get the message refused. */
async function postTelegram(text: string): Promise<void> {
  if (!env.OPS_TELEGRAM_BOT_TOKEN || !env.OPS_TELEGRAM_CHAT_ID) return;
  await post('telegram', `https://api.telegram.org/bot${env.OPS_TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: env.OPS_TELEGRAM_CHAT_ID,
    text,
    disable_web_page_preview: true,
  });
}

async function postEmail(alert: Alert, body: string): Promise<void> {
  if (!env.OPS_EMAIL || !isEmailConfigured()) return;
  try {
    await sendOperationalEmail(env.OPS_EMAIL, `[Vokve ${alert.severity}] ${alert.title}`, body);
  } catch (error) {
    logger.warn({ err: error }, 'alerts.email_failed');
  }
}
