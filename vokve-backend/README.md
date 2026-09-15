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
# 6. see the coins expire: run the idle sweep as of 91 days from now, then read the wallet again
curl -s $B/dev/jobs/coin-expiry -H "$H" -H "authorization: Bearer <access>" -H "x-vokve-device-id: dev_…" -d "{\"now\":\"$(date -u -v+91d +%Y-%m-%dT%H:%M:%SZ)\"}"
```

## Jobs

`src/jobs/scheduler.ts` ticks hourly inside the API process and runs each daily job once per UTC day (claim key in Redis/memory KV, so two instances never both run it). Today: the coin idle-expiry sweep (`expireIdleWallets`, RULES E9). Runs on boot too, so a process started at 00:05 does not wait a day.

## Tests

```sh
npm test        # vitest + mongodb-memory-server (replica set), no Docker needed
```

## Layout

```
src/config      env, defaults (every ⚙ value), remote config (app_config overrides)
src/lib         errors (the client's ApiError shape), coins (milli-coins), dates (local day), tokens, otp
src/middleware  requestContext (X-Vokve-* headers), auth, device (428), version (426), idempotency, rateLimit
src/modules     identity · devices · economy · training · activity · platform
src/seed        catalogue + config fixtures
test            integration tests against a real replica set
```
