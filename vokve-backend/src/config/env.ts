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
   * This API's own origin, used to build the absolute URLs it hands out for
   * media it serves (RULES P10). Behind a proxy this is the public address,
   * not the port the process listens on.
   */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  /**
   * The Firebase service account for push (FCM), as its three fields. Absent
   * means no push channel: feed rows only, and every send is logged as
   * `push.no_provider`. `config/serviceAccount.ts` resolves them, and still
   * accepts the whole JSON — or a path to it — in `FIREBASE_SERVICE_ACCOUNT`.
   */
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  /** The older single-variable form: the JSON itself, or a path to the file. */
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  /**
   * Play Integrity: a service account allowed to call `decodeIntegrityToken`
   * for the app. Absent means tokens the app sends are recorded as
   * unverifiable — nothing is decoded.
   */
  PLAY_INTEGRITY_PROJECT_ID: z.string().optional(),
  PLAY_INTEGRITY_CLIENT_EMAIL: z.string().optional(),
  PLAY_INTEGRITY_PRIVATE_KEY: z.string().optional(),
  /** The older single-variable form: the JSON itself, or a path to the file. */
  PLAY_INTEGRITY_SERVICE_ACCOUNT: z.string().optional(),
  /** The Cloud project linked in Play Console. Wins over `integrity.playIntegrity.cloudProjectNumber`. */
  PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: z.coerce.number().int().positive().optional(),
  /**
   * Google's key attestation revocation list. An empty value turns the
   * check off — tests, and a box with no way out to the internet.
   */
  ATTESTATION_STATUS_URL: z.string().default('https://android.googleapis.com/attestation/status'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(60),
  /** Dev only — OTP codes echoed in responses. Hard-refused in production. */
  OTP_DEV_ECHO: z
    .string()
    .optional()
    .transform(v => v === 'true' || v === '1'),
  /**
   * The developer endpoints — `POST /dev/steps`, `POST /dev/jobs/*` — which
   * set a day's verified steps and run the jobs by hand. They are off in
   * production by `NODE_ENV` alone, but `NODE_ENV` is one forgotten
   * environment variable away from being wrong, and a deployment that
   * forgot it would be handing every member an endpoint that writes their
   * own step count. `DEV_ROUTES=false` switches them off whatever
   * `NODE_ENV` says, so a real deployment can refuse them twice.
   */
  DEV_ROUTES: z
    .string()
    .optional()
    .transform(v => v !== 'false' && v !== '0'),
  LOG_LEVEL: z.string().default('info'),

  /**
   * The operator's key for the admin HTTP API (`/v1/admin/*`), which is how
   * diet plans and other curated content are written. Unset means the admin
   * surface does not exist on this server: the routes answer 404, so a box
   * that was never meant to be administered does not advertise a door.
   */
  ADMIN_API_KEY: z.string().min(24).optional(),
  /** Who the audit log records for admin writes. */
  ADMIN_ACTOR: z.string().default('admin'),

  /** Email channel (OTP). Any SMTP — Gmail app password works for dev. Unset = no email channel. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  /**
   * Who collects the money side of an order. `mock` captures every payment
   * at once (dev and test); `razorpay` creates a gateway order and verifies
   * the checkout signature, and needs both keys. Refused in production
   * unless it is a real provider.
   */
  PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),

  /** SMS channel (OTP). Nothing implemented yet (D-31); the name reserves the slot. */
  SMS_PROVIDER: z.enum(['msg91', 'twilio']).optional(),
});

export const env = envSchema.parse(process.env);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Whether the developer endpoints are mounted at all (RULES A26): never in
 * production, and only where `DEV_ROUTES` has not been turned off.
 */
export const devRoutesEnabled = !isProduction && env.DEV_ROUTES;

if (isProduction && env.OTP_DEV_ECHO) {
  throw new Error('OTP_DEV_ECHO must not be enabled in production');
}
if (isProduction && env.JWT_SECRET === 'dev-only-secret-change-me-please') {
  throw new Error('JWT_SECRET must be set in production');
}
if (isProduction && env.PAYMENT_PROVIDER === 'mock') {
  throw new Error('PAYMENT_PROVIDER must be a real gateway in production');
}
if (env.PAYMENT_PROVIDER === 'razorpay' && (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)) {
  throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when PAYMENT_PROVIDER=razorpay');
}
