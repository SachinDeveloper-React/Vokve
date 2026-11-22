import { env } from '../config/env.js';
import { raiseAlert } from './alerts.js';

/**
 * Knowing the OTP email has stopped, before a member says so (RULES P20).
 *
 * Every way into an account that is not Google or Apple runs through one
 * SMTP login, and a personal Gmail account stops at about 500 emails a day
 * and then refuses everything for up to a day. A member sees "We could not
 * send the email right now" and leaves; until this, the server knew and
 * wrote it to a log nobody was reading. Two alarms: one at 80% of the day's
 * limit, while there is still time to do something, and one on the first
 * send that fails.
 *
 * Neither goes out by email. The ops email travels through the same SMTP
 * account, so it would fail with the fault it is reporting.
 */

/** Share of the daily limit at which the warning starts. */
const WARN_SHARE = 0.8;

/**
 * The SMTP account's daily limit: `MAIL_DAILY_LIMIT`, or Gmail's ~500 when
 * the host is Gmail's and nothing was said. Workspace accounts also send
 * through smtp.gmail.com with a limit of 2000, so they set it explicitly.
 */
export function mailDailyLimit(): number | null {
  if (env.MAIL_DAILY_LIMIT) return env.MAIL_DAILY_LIMIT;
  return /(^|\.)gmail\.com$/i.test(env.SMTP_HOST ?? '') ? 500 : null;
}

/** After a successful send. Never throws. */
export async function warnIfNearMailLimit(sentToday: number | null): Promise<void> {
  const limit = mailDailyLimit();
  if (!limit || sentToday === null || sentToday < Math.floor(limit * WARN_SHARE)) return;
  await raiseAlert({
    key: 'mail.quota_near',
    severity: sentToday >= limit * 0.95 ? 'critical' : 'warning',
    title: 'OTP email is close to its daily limit',
    lines: [
      `${sentToday} of about ${limit} emails sent today (UTC day, counted by this server).`,
      'At the limit the provider refuses every email for up to a day — sign-up, email sign-in and password-reset codes stop with it. Google and Apple sign-in keep working.',
      'Fix: move SMTP to Amazon SES, Resend or Google Workspace. Only SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM change.',
    ],
    skipEmail: true,
  }).catch(() => false);
}

type MailFailureKind = 'quota' | 'login' | 'unreachable' | 'refused';

interface SmtpError {
  code?: string;
  responseCode?: number;
  response?: string;
  message?: string;
}

/**
 * Which of the four ways a send fails this was — each needs a different
 * fix, so each is its own alarm and one does not quieten another.
 */
export function classifyMailFailure(error: unknown): MailFailureKind {
  const e = (error ?? {}) as SmtpError;
  const said = `${e.response ?? ''} ${e.message ?? ''}`;
  // Gmail: `550-5.4.5 Daily user sending limit exceeded`; `421 4.7.0 Try
  // again later` and `454 4.7.0 Too many login attempts` are its throttles.
  if (/5\.4\.5|sending limit|limit exceeded|quota|too many (messages|emails|login)|rate.?limit|try again later/i.test(said)) {
    return 'quota';
  }
  if (e.code === 'EAUTH' || e.responseCode === 535 || e.responseCode === 534) return 'login';
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ECONNRESET'].includes(e.code ?? '')) {
    return 'unreachable';
  }
  return 'refused';
}

const TITLES: Record<MailFailureKind, string> = {
  quota: 'OTP email has hit its sending limit',
  login: 'The mail server refused our login',
  unreachable: 'The mail server cannot be reached',
  refused: 'OTP email is being refused',
};

const FIXES: Record<MailFailureKind, string> = {
  quota: 'Gmail refuses for up to 24 hours after its daily limit. Move SMTP to Amazon SES, Resend or Google Workspace — only SMTP_* and MAIL_FROM change.',
  login: 'The app password was revoked or changed, or 2-step verification was turned off. Make a new app password and update SMTP_PASS.',
  unreachable: 'SMTP_HOST / SMTP_PORT are wrong, or the provider is down. It may pass by itself; if it lasts, check the provider status page.',
  refused: 'Read the provider’s answer above. A wrong MAIL_FROM (553) or a blocked recipient domain are the usual causes.',
};

/** On a failed OTP send. Never throws. */
export async function alertMailFailure(error: unknown, purpose: string): Promise<void> {
  const kind = classifyMailFailure(error);
  const e = (error ?? {}) as SmtpError;
  const answer = (e.response ?? e.message ?? String(error)).slice(0, 300);
  await raiseAlert({
    key: `mail.failed:${kind}`,
    severity: 'critical',
    title: TITLES[kind],
    lines: [
      `A ${purpose} code could not be sent. Members trying to sign up, sign in by email or reset a password are being told to try again later.`,
      `Provider said: ${answer}${e.code ? ` (${e.code})` : ''}`,
      FIXES[kind],
      'Search the log for "mail.failed" for every attempt since.',
    ],
    skipEmail: true,
  }).catch(() => false);
}
