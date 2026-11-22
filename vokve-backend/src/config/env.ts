import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment, validated once at boot. A missing or malformed value fails the
 * process immediately rather than surfacing as a confusing runtime error.
 */
/**
 * An optional value that a blank line in `.env` means "unset", not "invalid".
 *
 * `.env.example` ships every optional key with nothing after the `=`, and a
 * copied example is how most of these files start life. Plain `z.string()`
 * never noticed, because `''` is a string — but a checked format does, so
 * `OPS_WEBHOOK_URL=` on its own line refused to parse and took the whole
 * server down at boot over a variable whose entire purpose is to be
 * skippable. Blank is the same as absent; anything else is still checked.
 */
function unsetWhenBlank<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(value => (value === '' ? undefined : value), schema.optional());
}

/**
 * The same rule for a key that falls back to a value rather than to nothing.
 *
 * `.default()` only fires on `undefined`, so a key emptied in `.env` reached
 * the format check and took the boot down exactly as the optional ones did
 * — a fault nobody would have found until the day somebody cleared a line
 * instead of deleting it.
 */
function blankIsDefault(schema: z.ZodString, fallback: string) {
  return z.preprocess(value => (value === '' ? undefined : value), schema.default(fallback));
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * How many reverse proxies stand between the internet and this process,
   * which is how many entries at the end of `X-Forwarded-For` to believe.
   *
   * Each proxy appends the address it saw, so with one proxy the last entry
   * is the caller and everything before it is whatever the caller typed.
   * Believing the whole header — Express's `trust proxy: true`, which this
   * was — takes the *first* entry, the caller's own, and every per-IP limit
   * in the API (sign-in, OTP send, OTP verify) then counts an address the
   * request chose for itself.
   *
   * One is right for a single platform proxy: Vercel, Render, Railway, Fly,
   * one nginx. Two for a CDN in front of that. Too low is the safe way to
   * be wrong but not a harmless one — the limits then count the proxy's
   * address, so every member shares a bucket; if sign-ins start answering
   * 429 for everybody after a hosting change, this is the number to raise.
   * Zero trusts nothing and uses the socket's address.
   *
   * A blank value is the default, not zero: `z.coerce` reads `''` as 0.
   */
  TRUST_PROXY_HOPS: z.preprocess(value => (value === '' ? undefined : value), z.coerce.number().int().min(0).max(10).default(1)),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/vokve?replicaSet=rs0&directConnection=true'),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-please'),
  /**
   * The secret being rotated out (RULES Z1). Tokens it signed are still
   * believed — signing always uses `JWT_SECRET` — so a rotation is: move the
   * old value here, put a new one in `JWT_SECRET`, deploy, and delete this
   * line once the longest-lived token it signed has expired (15 minutes for
   * a session; an admin session lasts 12 hours). Refresh tokens are opaque
   * and unaffected.
   */
  JWT_SECRET_PREVIOUS: unsetWhenBlank(z.string().min(16)),
  /**
   * Browser origins allowed to read this API's answers (CORS), comma
   * separated, matched exactly: `https://admin.vokve.app`. The app is native
   * and the panel calls from its server, so neither needs one — unset means
   * no browser origin is allowed, except on public media (avatars), which
   * any page may show.
   */
  CORS_ORIGINS: unsetWhenBlank(z.string().min(1)),
  /** Where a referral link points (RULES F6). The page redirects to the store until deep links exist. */
  SHARE_URL_BASE: blankIsDefault(z.string().url(), 'https://vokve.app/r'),
  /**
   * This API's own origin, used to build the absolute URLs it hands out for
   * media it serves (RULES P10). Behind a proxy this is the public address,
   * not the port the process listens on.
   */
  PUBLIC_BASE_URL: blankIsDefault(z.string().url(), 'http://localhost:3000'),
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
   * `pretty` prints coloured one-line logs (errors red, warnings orange,
   * success green, every request with its status and error code); `json`
   * prints one JSON object a line for a log collector. `auto` is pretty in
   * a terminal and JSON anywhere else.
   */
  LOG_FORMAT: z.enum(['auto', 'pretty', 'json']).default('auto'),

  /**
   * The operator's key for the admin HTTP API (`/v1/admin/*`), which is how
   * diet plans and other curated content are written. Unset means the admin
   * surface does not exist on this server: the routes answer 404, so a box
   * that was never meant to be administered does not advertise a door.
   */
  ADMIN_API_KEY: z.string().min(24).optional(),
  /** Who the audit log records for admin writes. */
  ADMIN_ACTOR: z.string().default('admin'),
  /**
   * The operator's second factor (RULES Z7): a base32 TOTP secret, the one
   * an authenticator app is enrolled with (`npm run admin:totp` makes one).
   * Set, the admin key alone opens nothing — the panel signs in with key +
   * six-digit code at `POST /v1/admin/session` and uses the session that
   * returns. Unset, the key alone still works, as it always has.
   */
  ADMIN_TOTP_SECRET: unsetWhenBlank(z.string().regex(/^[A-Za-z2-7]{16,}=*$/, 'must be a base32 secret of at least 16 characters (npm run admin:totp)')),

  /** Email channel (OTP). Any SMTP — Gmail app password works for dev. Unset = no email channel. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  /**
   * How many emails the SMTP account may send in a day, for the early
   * warning at 80% of it (RULES P20). A personal Gmail stops at about 500
   * and then refuses everything — every sign-up, sign-in and reset code —
   * for up to a day, so with `SMTP_HOST=smtp.gmail.com` and this unset, 500
   * is assumed. Set it for anything else (Google Workspace: 2000; SES: the
   * account's own quota); unset on a non-Gmail host means no warning.
   */
  MAIL_DAILY_LIMIT: unsetWhenBlank(z.coerce.number().int().positive()),

  /**
   * Where the alarms go (RULES P19, P20).
   *
   * Three channels, all optional, because an operator who gets none still
   * has the panel and the log — the alarms exist so that nobody has to be
   * *watching* for the app to be broken for an afternoon without anyone
   * knowing. The webhook posts `{ text, content }`, which Slack, Discord,
   * Google Chat and most of the rest accept; Telegram needs a bot token and
   * the chat to post to; the email goes through the same SMTP the OTPs use,
   * which is why it cannot carry the one alarm about that SMTP failing. With
   * none set the checks still run and still log, and nothing is sent.
   */
  OPS_WEBHOOK_URL: unsetWhenBlank(z.string().url()),
  OPS_TELEGRAM_BOT_TOKEN: unsetWhenBlank(z.string().min(20)),
  OPS_TELEGRAM_CHAT_ID: unsetWhenBlank(z.string().min(1)),
  OPS_EMAIL: unsetWhenBlank(z.string().email()),

  /**
   * Where catalogue images live (RULES R18).
   *
   * Member avatars are kept in Mongo as bytes, which is fine for one small
   * square per account that only that account's screens ask for. A product
   * gallery is neither: ten photos an item, every one of them on a shelf
   * that every member scrolls, and serving those out of the database means
   * paying for the read, the memory and the bandwidth on every scroll. So
   * the catalogue's images go to a bucket and are served from it.
   *
   * All four or none. A half-configured bucket is the worst of both — the
   * panel would offer an upload that fails at the last step, after the
   * operator has chosen the file.
   */
  AWS_REGION: unsetWhenBlank(z.string().min(1)),
  AWS_S3_BUCKET: unsetWhenBlank(z.string().min(1)),
  AWS_ACCESS_KEY_ID: unsetWhenBlank(z.string().min(1)),
  AWS_SECRET_ACCESS_KEY: unsetWhenBlank(z.string().min(1)),
  /**
   * The host images are read back through — a CloudFront domain, or any
   * CDN in front of the bucket. Unset serves straight from S3, which works
   * and costs more per view than it needs to.
   */
  AWS_S3_PUBLIC_BASE: unsetWhenBlank(z.string().url()),

  /**
   * The **web** OAuth client id(s) Google ID tokens are checked against
   * (RULES O12).
   *
   * Web, even though the tokens come from Android and iOS: that is the
   * audience the native SDKs put in a token when they are configured
   * with `webClientId`, and it is the one value that says "this token
   * was minted for us". Unset means the Google route answers 503 rather
   * than accepting anything.
   *
   * A **comma-separated list** is allowed, and is not a loosening: a
   * Firebase project whose Android and iOS apps were added at different
   * times carries a different web client in each bundled file —
   * `default_web_client_id` in `google-services.json`, `WEB_CLIENT_ID`
   * in the plist — so the two platforms honestly mint different
   * audiences. Accepting both of *our own* clients is right; the
   * alternative is one platform silently failing every sign-in. Each
   * entry is still checked exactly, so this is nothing like accepting
   * any audience.
   */
  GOOGLE_WEB_CLIENT_ID: unsetWhenBlank(z.string().min(1)),

  /**
   * Who an Apple identity token may be addressed to (RULES O13): a
   * **comma-separated list** of our own Apple client ids, each matched
   * exactly against the token's `aud`.
   *
   * A list because the two platforms honestly mint different audiences.
   * iOS signs in natively and Apple addresses the token to the app's
   * **bundle id** (`com.vokve.fitness`); Android has no native Apple
   * sign-in, goes through Apple's web flow, and that token is addressed
   * to the **Services ID** the web flow was opened with. Both are ours.
   * Unset means `POST /auth/apple` answers 503 rather than accepting
   * anything.
   */
  APPLE_CLIENT_IDS: unsetWhenBlank(z.string().min(1)),
  /**
   * The Sign in with Apple private key (the `.p8` file's contents), its
   * key id and the team id — what the server signs its `client_secret`
   * with to talk to Apple's token endpoints. Needed for one thing: revoking
   * a member's Apple authorisation when they delete their account or
   * disconnect Apple (App Store Review Guideline 5.1.1(v), RULES O16). All
   * three or none; without them deletion still works and says so in the
   * log and the ops alert.
   */
  APPLE_TEAM_ID: unsetWhenBlank(z.string().min(1)),
  APPLE_KEY_ID: unsetWhenBlank(z.string().min(1)),
  APPLE_PRIVATE_KEY: unsetWhenBlank(z.string().min(1)),
  /**
   * The return URL the Android app opens Apple's web flow with
   * (`appleRedirectUri` in the app's config). Apple asks for it again when
   * a code from that flow is exchanged; native iOS codes have none.
   */
  APPLE_REDIRECT_URI: unsetWhenBlank(z.string().url()),

  /**
   * Who collects the money side of an order. `mock` captures every payment
   * at once (dev and test); `razorpay` creates a gateway order and verifies
   * the checkout signature, and needs both keys. Refused in production
   * unless it is a real provider.
   */
  PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
  /**
   * TEMPORARY bypass while the gateway is not wired yet: lets
   * `PAYMENT_PROVIDER=mock` boot in production instead of refusing.
   * The mock accepts any payment id, so a money order is marked paid
   * without money — keep the shop coins-only while this is on, and
   * delete this line from `.env` the day Razorpay keys go in.
   */
  ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: z
    .string()
    .optional()
    .transform(v => v === 'true' || v === '1'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),

  /** SMS channel (OTP). Nothing implemented yet (D-31); the name reserves the slot. */
  SMS_PROVIDER: z.enum(['msg91', 'twilio']).optional(),
});

/**
 * Stops the boot with a readable reason. Runs before the logger exists (the
 * logger reads this file), so it is plain stderr — red in a terminal.
 */
function refuseToStart(lines: string[]): never {
  const red = (s: string) => (process.stderr.isTTY && !('NO_COLOR' in process.env) ? `\x1b[31m${s}\x1b[0m` : s);
  process.stderr.write(`${red('✗ vokve-backend cannot start:')}\n${red(lines.map(l => `  • ${l}`).join('\n'))}\n`);
  process.exit(1);
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  refuseToStart(parsed.error.issues.map(i => `${i.path.join('.') || '(env)'}: ${i.message}`));
}
export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Whether the developer endpoints are mounted at all (RULES A26): never in
 * production, and only where `DEV_ROUTES` has not been turned off.
 */
export const devRoutesEnabled = !isProduction && env.DEV_ROUTES;

if (isProduction && env.OTP_DEV_ECHO) {
  refuseToStart(['OTP_DEV_ECHO must not be enabled in production']);
}
/**
 * A value copied from `.env.example` or the code's own fallback. Those are
 * public — they are in the repository — so a server signing with one is a
 * server anybody can mint sessions for.
 */
const isPlaceholder = (value: string) => /change-me|dev-only|example|placeholder/i.test(value);

if (isProduction && (env.JWT_SECRET.length < 32 || isPlaceholder(env.JWT_SECRET))) {
  refuseToStart(['JWT_SECRET must be a random value of at least 32 characters in production (openssl rand -base64 48)']);
}
if (isProduction && env.ADMIN_API_KEY && isPlaceholder(env.ADMIN_API_KEY)) {
  refuseToStart(['ADMIN_API_KEY is still the placeholder from .env.example (openssl rand -base64 36)']);
}
if (isProduction && env.PAYMENT_PROVIDER === 'mock' && !env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION) {
  refuseToStart(['PAYMENT_PROVIDER must be a real gateway in production']);
}
if (env.PAYMENT_PROVIDER === 'razorpay' && (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)) {
  refuseToStart(['RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when PAYMENT_PROVIDER=razorpay']);
}
