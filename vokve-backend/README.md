# vokve-backend

Express + TypeScript + MongoDB (Atlas / local replica set) + Redis. The API the VOKVE app calls — spec in [`../docs/BACKEND.md`](../docs/BACKEND.md), rules in [`../docs/backend/RULES.md`](../docs/backend/RULES.md).

## Run locally

```sh
cp .env.example .env
docker compose up -d          # mongo (replica set rs0) + redis
npm install
npm run seed                  # exercises, templates, app_releases, app_config defaults
npm run dev                   # http://localhost:3000/v1
```

Transactions need a replica set — the compose file initialises `rs0`. Atlas is already one; for Atlas set `MONGODB_URI` to the SRV string and drop the `replicaSet`/`directConnection` params.

## OTP: where the code goes

- **Sign-up code → email** (`otp.signupChannel = 'email'` in `app_config`) while there is no SMS provider. The phone is asked for later, only once SMS can deliver.
- **Real email** needs SMTP in `.env` — any SMTP; for Gmail turn on 2-step verification, create an *App password* (Google Account → Security → App passwords) and set `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM`. Restart the server.
- **Without SMTP** (or for phone codes, which have no provider yet) the code is only logged. With `OTP_DEV_ECHO=true` it is also returned in every challenge as `devCode`, and **the app shows it on the OTP screen in dev builds** ("Dev build · code is 340355 · tap to fill"). The server refuses to start with echo on in production.
- `GET /config` reports `otp.channels.{email,sms}` so the client knows what can be delivered.

### No Docker yet?

```sh
npm run dev:memory     # in-memory replica set, seeded, OTP echoed — data resets on exit
```

## Smoke test

```sh
B=http://localhost:3000/v1
H='content-type: application/json'
D='x-vokve-platform: android' ; V='x-vokve-app-version: 1.0.0'

# 1. sign up → OTP to the email (code echoed as devCode)
curl -s $B/auth/sign-up -H "$H" -H "$D" -H "$V" -d '{"email":"asha@example.com","phone":"+919876543210","password":"walk1000steps","dateOfBirth":"1994-03-21","gender":"female"}'
# 2. verify → session; nextVerification is null until SMS exists
curl -s $B/auth/verify-otp -H "$H" -d '{"verificationId":"vrf_…","code":"123456"}'
# 3. register the device (first authenticated call)
curl -s $B/devices/register -H "$H" -H "authorization: Bearer <access>" -d '{"installId":"11111111-2222-3333-4444-555555555555","platform":"android","profile":{"model":"Pixel 8","osVersion":"14","app":{"version":"1.0.0","build":"1"}}}'
# 4. everything else needs the device id
curl -s $B/me -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" -H "$D" -H "$V"
# 5. exercise the daily cap: 20k steps → 19 coins held; a workout → 100 credited; check the wallet
curl -s $B/dev/steps -H "$H" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" -d '{"steps":20000}'
curl -s $B/wallet -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…"
# 6. browse the catalogue: the shelves with counts, then a shelf sorted by price, then a search
curl -s "$B/shop/categories" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…"
curl -s "$B/shop/items?category=gym&sort=price_asc&inStock=true&limit=20" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…"
curl -s "$B/shop/items?q=racket" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…"
# 7. buy: add an address, put a cap in the basket, see the split (30% coins, the rest money), check out with 300 coins, pay (mock gateway accepts any id)
curl -s $B/me/addresses -H "$H" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" -d '{"label":"Home","name":"Asha Verma","phone":"+919876543210","line1":"12 MG Road","city":"Bengaluru","state":"Karnataka","postalCode":"560001"}'
curl -s $B/cart/lines -X PUT -H "$H" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" -d '{"itemId":"cap","quantity":1}'
curl -s $B/checkout -H "$H" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" -H "idempotency-key: $(uuidgen)" -d '{"fromCart":true,"addressId":"adr_…","coins":300}'
curl -s $B/orders/ord_…/pay -H "$H" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" -H "idempotency-key: $(uuidgen)" -d '{"providerPaymentId":"pay_test"}'
# (1,000+ coins in one order asks for a step-up code first — POST /auth/step-up, verify-otp, pass stepUpToken)
curl -s $B/orders -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…"
# save something for later, and say what you thought of what arrived
curl -s $B/wishlist/yoga-mat -X PUT -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…"
curl -s $B/shop/items/cap/reviews/me -X PUT -H "$H" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" -d '{"rating":5,"title":"Fits well","body":"Stays on through a run, and the peak holds its shape."}'
# 8. the account's own surface: the profile summary, the privacy switches, the devices, and a help search
curl -s $B/me/profile -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…"
curl -s $B/me/privacy -X PUT -H "$H" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" -d '{"analytics":false}'
curl -s $B/me/sessions -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…"
curl -s "$B/support/faqs?q=expire" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…"
curl -s $B/app/about -H "$H"
# a profile photo: base64 in, an absolute media URL back, served to anyone with the link
curl -s $B/me/avatar -H "$H" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" \
  -d "{\"contentType\":\"image/jpeg\",\"data\":\"$(base64 < photo.jpg | tr -d '\n')\"}"
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $B/media/avatars/avt_…
# change the password (signs every other device out), then schedule a deletion and call it off
curl -s $B/me/password -X PUT -H "$H" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" -d '{"currentPassword":"walk1000steps","newPassword":"newpass123"}'
curl -s $B/me/deletion -H "$H" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" -d '{"password":"newpass123","reason":"Taking a break"}'
curl -s $B/me/deletion -X DELETE -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…"
# 9. see the coins expire: run the idle sweep as of 91 days from now, then read the wallet again
curl -s $B/dev/jobs/coin-expiry -H "$H" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" -d "{\"now\":\"$(date -u -v+91d +%Y-%m-%dT%H:%M:%SZ)\"}"
```

## Jobs

`src/jobs/scheduler.ts` ticks hourly inside the API process. Daily jobs run once per UTC day (claim key in Redis/memory KV, so two instances never both run one): the coin expiry warnings (`warnExpiringWallets`, RULES E10 — feed row + push at 14 and 3 days) and then the idle-expiry sweep (`expireIdleWallets`, RULES E9). Hourly, unclaimed: `flushDeferredPushes` sends the pushes quiet hours held back, `expireUnpaidOrders` releases unpaid orders, `releaseDueHolds` pays step coins out of escrow once their window has passed — or, out of shadow mode, voids a hold whose day has since been found wanting (RULES E15) — `warnStreaksAtRisk` tells each member whose streak is not yet covered, at 19:00 in their zone (RULES S10), and `closeDueWeeks` freezes and pays last week's country leaderboard a few hours into Monday (RULES L6, L10). Runs on boot too, so a process started at 00:05 does not wait a day.

## Steps (Phase 2 — shadow mode)

The app counts with react-native-step-tracker-pro and sends one **signed snapshot** per day (BACKEND §7.3, §15):

1. `POST /devices/:id/attestation/challenge`, then `POST /devices/:id/attestation` with the Keystore key `attestDevice()` made — the chain is checked to Google's roots (`src/lib/attestation`), and an unattestable key is kept as `attested: false`.
2. `POST /activity/ingest/nonce`, then `POST /activity/ingest` with `getSignedSnapshot()`'s block. The signature is verified over the exact bytes before anything in them is read; `INTEGRITY_REQUIRED` asks for a Play Integrity token now and then.
3. The rollup scores the day (`src/modules/activity/layers.ts`, L0–L6) into `activity_daily` and `fraud_flags`, and updates the trust score. Nothing is minted while `app_config` `coins.steps.enabled` is off.
4. The app reads everything back from here: `GET /activity/config` (how its tracker is set up and when it syncs — ⚙ `activity.tracker`, `activity.sync`), `/activity/today`, `/weekly`, `/day`, `/range`, and `GET /activity/sources?date=` — how the day was matched across phones and Health Connect apps (`report.service.ts`).

Play Integrity needs `PLAY_INTEGRITY_SERVICE_ACCOUNT` and the Cloud project number (`PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER`, or `integrity.playIntegrity.cloudProjectNumber` in `app_config`); without them no verdict is asked for. Set `integrity.android.signingCertSha256` to the release certificate's SHA-256 before production so a re-signed APK's key is not attested.

## Everything the app shows is served

Nothing on a screen comes from the app's own seed data (MEMORY D-45). Beyond steps, wallet, shop and the account:

- **Streak** (`modules/streak`) — `GET /streak`, `POST /streak/freeze`, `POST /streak/restore` (debit + days in one transaction). Days are earned by a plausible workout or verified steps at the user's goal (⚙ `streak.earnedBy`).
- **Challenges and achievements** (`modules/challenges`) — `GET /challenges?date=`, `GET /achievements`; completion is automatic after each rollup / workout save.
- **Leaderboard** (`modules/leaderboard`) — `GET /leaderboard`, `/leaderboard/history`, `/leaderboard/reward-tiers`.
- **Water** (`modules/hydration`) — `/hydration/today`, `/entries`, `/stats`, `/days`, `/reminders`.
- **Food** (`modules/nutrition`) — `/nutrition/day`, `/days`, `/entries`, `/profile`, `/foods`, `/foods/quick-add`, `/foods/custom`, `/diet-plan`, `/diet-plan/days`.
- **Vitals** (`modules/vitals`) — `/vitals`, `/vitals/latest`, `/health/score`.
- **Words** (`modules/content`) — `GET /content/tips/:topic`, one tip (or Home's motivation line) per topic per day.

Rewards that steps can earn — step coins, streak milestones, step-derived challenges, leaderboard prizes — all wait for ⚙ `coins.steps.enabled` (D-46); everything is recorded meanwhile.

## Notifications and push

`modules/notifications` is the feed (`GET /notifications`, `/counts`, read endpoints) and `notify()` is how anything tells a user something: feed row first, then a push if the topic's category switch is on, deferred to the end of quiet hours in the user's zone. Push goes out over FCM once `FIREBASE_SERVICE_ACCOUNT` is set (the service-account JSON, or a path to it — see `.env.example`); without it `lib/push.ts` logs `push.no_provider` and the feed row is the only channel. The app registers its token with `PATCH /devices/:id { pushToken }` after sign-in and withdraws it on sign-out.

## Tests

```sh
npm test        # vitest + mongodb-memory-server (replica set), no Docker needed
```

## Layout

```
src/config      env, defaults (every ⚙ value), remote config (app_config overrides)
src/lib         errors (the client's ApiError shape), coins (milli-coins), dates (local day), tokens, otp
src/middleware  requestContext (X-Vokve-* headers), auth, device (428), version (426), idempotency, rateLimit
src/lib/attestation  Google's attestation roots, key attestation, the revocation list
src/modules     identity · devices · integrity · economy · training · activity · streak · challenges · leaderboard ·
                hydration · nutrition · vitals · content · notifications · commerce · social · account · platform
src/jobs        the in-process scheduler (daily: expiry warn + sweep, account purge; hourly: deferred pushes, unpaid
                orders, step holds, streak-at-risk, leaderboard close)
src/seed        catalogue (shop, food, diet plans, challenges, achievements, tips) + config fixtures
test            integration tests against a real replica set
```
