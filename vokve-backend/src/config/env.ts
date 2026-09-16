import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment, validated once at boot. A missing or malformed value fails the
 * process immediately rather than surfacing as a confusing runtime error.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/vokve?replicaSet=rs0&directConnection=true'),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-please'),
  /** Where a referral link points (RULES F6). The page redirects to the store until deep links exist. */
  SHARE_URL_BASE: z.string().url().default('https://vokve.app/r'),
  /**
   * The Firebase service account for push (FCM), as the JSON itself or a path
   * to the file. Absent means no push channel: feed rows only, and every
   * send is logged as `push.no_provider`.
   */
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(60),
  /** Dev only — OTP codes echoed in responses. Hard-refused in production. */
  OTP_DEV_ECHO: z
    .string()
    .optional()
    .transform(v => v === 'true' || v === '1'),
  LOG_LEVEL: z.string().default('info'),

  /** Email channel (OTP). Any SMTP — Gmail app password works for dev. Unset = no email channel. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  /** SMS channel (OTP). Nothing implemented yet (D-31); the name reserves the slot. */
  SMS_PROVIDER: z.enum(['msg91', 'twilio']).optional(),
});

export const env = envSchema.parse(process.env);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

if (isProduction && env.OTP_DEV_ECHO) {
  throw new Error('OTP_DEV_ECHO must not be enabled in production');
}
if (isProduction && env.JWT_SECRET === 'dev-only-secret-change-me-please') {
  throw new Error('JWT_SECRET must be set in production');
}
