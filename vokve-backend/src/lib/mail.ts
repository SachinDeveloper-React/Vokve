import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Transactional email over SMTP. Any SMTP works — Gmail with an app password
 * for development, SES / Resend / MSG91 mail later — because the only thing
 * the code needs is a host and a login. Absent configuration means "no email
 * channel", which the OTP service treats as: log the code, echo it in dev,
 * refuse in production.
 */
let transporter: Transporter | null = null;

/** Tests swap the real SMTP transport for a capturing stub. */
export function setMailTransport(next: Transporter | null): void {
  transporter = next;
}

export function isEmailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM);
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

export type OtpEmailPurpose =
  | 'signup'
  | 'verify_email'
  | 'login'
  | 'reset_password'
  | 'change_email'
  | 'step_up';

const SUBJECTS: Record<OtpEmailPurpose, string> = {
  signup: 'Your VOKVE sign-up code',
  verify_email: 'Verify your email for VOKVE',
  login: 'Your VOKVE sign-in code',
  reset_password: 'Reset your VOKVE password',
  change_email: 'Confirm your new VOKVE email',
  step_up: 'Confirm it is you — VOKVE',
};

const INTROS: Record<OtpEmailPurpose, string> = {
  signup: 'Welcome to VOKVE. Enter this code in the app to finish creating your account.',
  verify_email: 'Enter this code in the app to verify your email address.',
  login: 'Enter this code in the app to sign in.',
  reset_password: 'Enter this code in the app to set a new password. If you did not ask for this, you can ignore this email — your password will not change.',
  change_email: 'Enter this code in the app to confirm this address as your new VOKVE email.',
  step_up: 'Enter this code in the app to confirm this action.',
};

export async function sendOtpEmail(to: string, code: string, purpose: OtpEmailPurpose, ttlMinutes: number): Promise<void> {
  const subject = SUBJECTS[purpose];
  const intro = INTROS[purpose];
  const text = `${intro}\n\nYour code: ${code}\n\nIt expires in ${ttlMinutes} minutes. Never share it with anyone — VOKVE will never ask you for it.\n\nMove • Earn • Achieve`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #e6e8eb">
    <div style="font-weight:800;font-size:22px;letter-spacing:2px;margin-bottom:4px">VOKVE</div>
    <div style="font-size:12px;letter-spacing:2.4px;color:#6b7280;margin-bottom:24px">MOVE • EARN • ACHIEVE</div>
    <p style="font-size:15px;line-height:1.5;margin:0 0 20px">${intro}</p>
    <div style="font-size:36px;font-weight:800;letter-spacing:10px;text-align:center;padding:18px;border-radius:12px;background:#f0f4ff;color:#1d4ed8;margin:0 0 20px">${code}</div>
    <p style="font-size:13px;color:#6b7280;line-height:1.5;margin:0">Expires in ${ttlMinutes} minutes. Never share this code — VOKVE will never ask you for it.</p>
  </div></body></html>`;

  await getTransporter().sendMail({ from: env.MAIL_FROM, to, subject, text, html });
  logger.info({ to: to.replace(/^(.).*(@.*)$/, '$1•••$2'), purpose }, 'mail.sent');
}
