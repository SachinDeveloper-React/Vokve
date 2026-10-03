# VOKVE Backend — Project Memory

**Purpose:** the file you read first when you come back to this backend after a week away — or when an AI assistant is asked to work on it. It holds the decisions that were made, the ones still open, the facts about the client that are easy to forget, and the traps that have already been found. Keep it current: every phase in [PHASES.md](PHASES.md) ends with an update here.

**Related:** [BACKEND.md](../BACKEND.md) · [PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [RULES.md](RULES.md)

---

## 1. Orientation in 60 seconds

- **Client:** React Native 0.87, TypeScript, zod-first models in `src/types/models.ts`, zustand stores in `src/stores/`, API layer in `src/services/api/` with a mock implementation. 30 screens. Last audited at commit `fdbc4b0`.
- **Backend:** does not exist yet. These docs specify it. Stack: TypeScript / Fastify / **MongoDB (Atlas, replica set)** / Mongoose / Redis / BullMQ (ARCHITECTURE §2).
- **The product loop:** verified steps + workouts → V-Coins → physical goods (shop) and weekly country leaderboard prizes.
- **The single most important fact:** the client **never mints coins and never writes streak days**. `coinsStore.earn()` and `streakStore.completeToday()` have no callers. Earning is 100% server-owned from day one; there is no client-earned history to migrate.
- **The single biggest risk:** steps can only be read on-device (Health Connect / HealthKit have no server API), so the server must verify what the client uploads. Caps first, escrow second, detection third — eight layers (BACKEND §7.5), a trust tier per user, and step coins held 24 h–7 d before release.
- **Every request is attributed to a device.** The client has no device id today; `react-native-device-info` is installed and unused. `POST /devices/register` on launch, seven `X-Vokve-*` headers after.
- **Both phone and email are OTP-verified.** Phone gates the session (existing contract); email gates spend/payout (D-20).

## 1a. Build status (2026-09-14)

**`vokve-backend/` exists and runs.** Express 5 · TypeScript · Mongoose 8 · MongoDB replica set · Redis (in-memory fallback) · vitest. 14 integration tests on a real replica set, all green; client's 427 Jest tests green; both typecheck.

| Done | Not yet |
|---|---|
| Phase 0 skeleton: request context, `X-Vokve-*` headers, ApiError shape, idempotency, rate limits, version gate (426), device gate (428), remote config with validation, seed | SMS / email providers (codes echoed with `OTP_DEV_ECHO`, D-31) |
| Auth: sign-up → phone OTP → session → **email OTP** (polymorphic `verify-otp`), sign-in by email *or* phone, refresh rotation bound to device, sign-out, passwordless `otp/request`, reset-password | Social sign-in, attestation (Play Integrity / App Attest — verdict recorded as `unverified`) |
| Devices: register (3 ids), heartbeat, list, revoke (immediate — debounce cleared), `app_releases`, `GET /releases` | `version_stats` job, push-token cleanup |
| Profile: `/me`, `PATCH /me` (strict whitelist), `complete-profile` (sole stamp), settings, notification preferences | Avatar upload, addresses, deletion/export |
| **Economy: ledger (milli-coins), balances, holds/escrow, `credit/hold/release/void/debit`, daily cap 300 atomic + per-source caps + partial grants, wallet with `pending/dailyCap/earnedToday/remainingToday`, earn-rules** | `releaseHolds` job, expiry jobs, reconciliation job, admin clawback API |
| Training: templates, exercises, `POST /workouts` (idempotent, recomputed volume/calories, plausibility → 100 coins via cap), paged history | Streak day marking (Phase 4) |
| Activity: `today`, `weekly`, `creditStepsForDay` (0.095/100, high-water mark → hold), **dev-only `POST /dev/steps`** | Real `POST /activity/ingest` (501 for now — Phase 2) |
| Auth completion (2026-09-14): forgot/reset password end-to-end (backend decoy challenges for unknown identifiers; client `ForgotPasswordScreen` + `ResetPasswordScreen`, SignIn arrival notice), change-phone / change-email routes, `requireVerifiedContacts` middleware ready for Phase 5 spend routes, `EmailVerificationBanner` on Wallet/Shop/Account | Social sign-in (needs provider credentials), step-up OTP (Phase 5), client UI for change phone/email (needs an Edit Profile screen) |
| **Auth error handling, both sides (2026-09-14):** `ApiError` now carries `code`, `details`, `fieldErrors`, `retryAfterSeconds`, `attemptsRemaining`, `isOtpChallengeDead`; server messages win over client copy. Client self-heals 428 (re-register device + replay once), hands 426 to `appStatusStore` → `UpgradeRequiredScreen`; launch failure that is *not* a refusal → `status: 'unreachable'` → `ConnectionErrorScreen` with retry (tokens kept); refusal (401/403/404) → signed out with a notice on SignIn; `TOO_MANY_DEVICES` on sign-in ends the session with the server's words; dead OTP challenges (expired/burned/gone) show as expired so the user reaches for resend; 429 on resend restarts the resend clock from `retryAfterSeconds`; 422 field errors land under the sign-up fields via `setError`; countdown restarts after a successful resend (a latent bug — identical figures never restarted it). Backend adds `Retry-After` on 429 and `retryAfterSeconds` on every OTP limit. 482 client tests / 17 backend tests green. | Social sign-in; step-up OTP; client UI for change phone/email |
| Client: `installId` + `react-native-device-info` profile, `POST /devices/register` on sign-in/restore, 7 headers on every request, additive schemas, `{data,nextCursor}` on `/workouts`, email OTP on the same `VerifyOtpScreen` via root route `VerifyEmail`, wallet sync into `coinsStore`, `useMockApi:false`, local API host (10.0.2.2 on Android) | Wallet "verify your email" banner; Shop/Streak still spend locally (server redeem is Phase 5) |

**Phase 2 step sync (2026-10-02) — built, shadow mode, mints nothing.**

- **Client:** `react-native-step-tracker-pro` 2.4 replaces `react-native-health-connect` (D-35). `src/services/steps.ts` owns the tracker: config, events, attestation, a signed snapshot per day with a fresh nonce, an MMKV queue flushed on foreground / every 15 min / midnight / backfill / reconnect. Step Tracking screen (counting, Health Connect read-only, OEM background limits, sync); Home and Analytics read the phone's history live; seed step data deleted.
- **Server:** `POST /devices/:id/attestation/challenge` + `/attestation` (Android key attestation verified to Google's roots by key, challenge, package, signer, revocation list); `POST /activity/ingest/nonce` + `/activity/ingest` (ECDSA signature over the exact signed bytes, nonce single-use, ±7-day window, Play Integrity on request); raw snapshot (latest per device-day, 30 d ⚙), `step_uploads`, `device_days`, `activity_samples`, `motion_windows`; inline rollup scoring L0–L6 into `activity_daily` + `fraud_flags`; trust score/tier (shadow); hourly `release-holds` job. Step coins behind ⚙ `coins.steps.enabled` (off).
- **Not yet:** a Play Integrity service account (tokens recorded as `unverifiable` until `PLAY_INTEGRITY_SERVICE_ACCOUNT` is set); `GET /activity/range`; the background-upload endpoint for the tracker's own `remoteSyncUrl`; the fraud dashboard and admin review queue; L7.

**Server-driven app (2026-10-02) — built, uncommitted.** Every screen reads the server; seed data serves only the mock API and tests (D-45). New modules: `streak` (D-44), `challenges` (D-46), `leaderboard` (D-47), `hydration` + `content` (D-48), `nutrition` (D-49), `vitals` (D-50). The app's caches start empty and show `LoadState` until the first answer; water, food and vitals are logged through persisted outboxes keyed by the app's own ids; read-only views go through `useServerRead` (memory cache, cleared on sign-out; re-read on step sync, on confirmations and on pull). Anything steps can earn — step coins, streak milestones, step-derived challenges, leaderboard prizes — waits for ⚙ `coins.steps.enabled`. Backend 173 tests, app 713, both typecheck.

Run without Docker: `npm run dev:memory` (in-memory replica set, seeded). With Docker: `docker compose up -d && npm run seed && npm run dev`.

## 2. Decision log

Format: **D-nn · date · status** — decision — rationale — where it lives.

| ID | Date | Status | Decision |
|---|---|---|---|
| D-01 | 2026-09-13 | **Decided** | Backend language is TypeScript so the client's zod schemas are the API contract verbatim. *Rationale:* strict client-side validation makes drift a hard failure; sharing schemas removes the class of bug. → ARCHITECTURE §2 |
| D-02 | 2026-09-13 | **Superseded by D-18** | ~~Modular monolith, one Postgres~~ → MongoDB. Modular monolith and Redis/BullMQ unchanged. |
| D-03 | 2026-09-13 | **Decided** (amended by D-18) | Coins move only via `economy.credit()` / `hold()` / `release()` / `debit()` inside a MongoDB session transaction, with a unique compound index `{userId, source, referenceType, referenceId}` as the anti-double-pay guarantee and a conditional `findOneAndUpdate({ balance: {$gte} }, {$inc})` as the overspend guard. No other code path touches `coin_ledger`. → RULES E1–E7, D1 |
| D-04 | 2026-09-13 | **Decided** | Do **not** build on Google Fit. Health Connect on Android, HealthKit on iOS. Google Fit's developer APIs are deprecated in favour of Health Connect; verify current turn-down dates but the direction is settled. → BACKEND §7.1 |
| D-05 | 2026-09-13 | **Decided** | Step ingestion ships (Phase 2) **before** step minting (Phase 3), with plausibility scoring in shadow mode for ≥ 2 weeks of production data. *Rationale:* thresholds guessed before launch punish honest users or wave through attacks. → PHASES |
| D-06 | 2026-09-13 | **Decided (amended)** | **Hard per-user daily coin ceiling `coins.dailyCap` = 300** (owner's requirement: 250–300 range, backend-enforced, changeable from config without deploy). Applies to all sources combined, counts holds on the day earned, atomic in the credit transaction, partial grants, remainder dropped; refunds and leaderboard payouts exempt. Per-source caps: steps 200 (20k steps), workout 100, others 300. Optional monthly cap off. *Rationale:* the payout ceiling is what makes the economy safe on day one. → BACKEND §8.2.1, RULES E8–E8f |
| D-07 | 2026-09-13 | **Superseded by D-44** | ~~Do verified steps alone (no workout) mark an earned streak day? Default: no.~~ Now a config switch, ⚙ `streak.earnedBy`. → RULES S9 |
| D-08 | 2026-09-13 | **Decided (2026-10-02, D-46)** | Challenge enrolment: everyone is enrolled in every open challenge, and a challenge completes itself when its goal is reached — no join, no claim. → RULES C4, C5 |
| D-09 | 2026-09-13 | **Open** (partly built) | Leaderboard country: from phone dial code at sign-up, editable once. Movers change boards next period. *Built so far:* the board reads `User.country` (default `IN`, D-29); setting it at sign-up and the once-only edit are not built. → RULES L2 |
| D-10 | 2026-09-13 | **Built as config** | Leaderboard score formula `⌊verified steps/100⌋ + workouts×50 + challenges×100` — weights are ⚙ `leaderboard.score`, so product can change them without a deploy. → RULES L3 |
| D-11 | 2026-09-13 | **Decided** | BMI is derived, never input. Weight has one write path (`/vitals` kind=weight → `User.weightKg` + `body_measurements`). → RULES V1, V4 |
| D-12 | 2026-09-13 | **Decided** | Streak restore debits with `source:'streak'` (negative), not `'purchase'`. → RULES E13 |
| D-13 | 2026-09-13 | **Decided** | `GET /workouts` gets the `{data, nextCursor}` envelope now, while no production client exists. → BACKEND §3.7 |
| D-14 | 2026-09-13 | **Built as config (D-50)** | Health score formula — RULES V8 (activity 30 / hydration 20 / vitals 20 / BMI 15 / consistency 15), weights ⚙ `health.scoreWeights`; product to confirm. |
| D-15 | 2026-09-13 | **Open** | Raw `activity_samples` retention: months (minimisation) vs years (fraud). *Default:* 13 months. |
| D-16 | 2026-09-13 | **Decided** | Nutrition logging mints no coins in v1. → RULES N9 |
| D-17 | 2026-09-13 | **Open** | Premium tier — not in v1 scope. Card exists in the client with a no-op. |
| D-18 | 2026-09-13 | **Decided** | **MongoDB** is the datastore (team standard). Transactions require a replica set (Atlas; `mongodb-memory-server` replset locally). Unique indexes enforce idempotency; `$jsonSchema` validators generated from the shared zod schemas. Time-series collections are analytics copies only (no unique indexes on them). → ARCHITECTURE §2, §6 |
| D-19 | 2026-09-13 | **Decided** | Device identity = three ids: client `installId` (UUID in Keychain/Keystore, canonical), OS `vendorId` (`DeviceInfo.getUniqueId()`), attestation key id. Server `deviceId` returned by `POST /devices/register` is what every request carries. → BACKEND §13.1, RULES §DV |
| D-20 | 2026-09-13 | **Decided (owner confirmed: professional default)** | Email verified by OTP as a **soft gate**: session is issued after the phone OTP (existing contract); email challenge auto-sent; `emailVerifiedAt` required before any spend/payout/email reset. Hard gate at sign-up is a one-flag change. → BACKEND §13.3, RULES §O |
| D-21 | 2026-09-13 | **Decided** | Step coins are **escrowed** in `coin_holds` and released after the user's trust-tier window (24 h / 72 h / 7 d / manual); new flags void the hold. Workouts, streaks, challenges, referrals credit directly. → BACKEND §7.6, RULES E15–E16, §T |
| D-22 | 2026-09-13 | **Decided** | Fake-step detection is eight layers (L0 device integrity … L7 economic) with remote-config weights; L1 uses a **denylist** of known step-fabrication packages plus an allowlist; unknown origins are unverified, not rejected. → BACKEND §7.5, RULES A14–A21 |
| D-23 | 2026-09-13 | **Decided** | Motion signature (L4) sends five summary features per 5-min window, never raw accelerometer traces. Opting out lowers trust tier, never blocks the app. → RULES A16 |
| D-24 | 2026-09-13 | **Decided** | Version gating: `app_releases` statuses; blocked builds get `426 UPGRADE_REQUIRED`; `minVersion` in `/config`; daily `version_stats`. → RULES DV6, DV11 |
| D-25 | 2026-09-13 | **Decided** | Step-up OTP before redemptions ≥ 1,000 coins ⚙ and for watch-tier users on any redemption. → RULES O8, T5 |
| D-26 | 2026-09-13 | **Decided (owner)** | **Step rate = 0.095 coins per 100 steps** (≈ 0.95 / 1,000 — Sweatcoin-like). Both the step unit and the coins-per-unit are remote config: `coins.steps.unitSteps = 100`, `coins.steps.coinsPerUnit = 0.095`. Credit per day = `floor(verifiedSteps / unitSteps) × coinsPerUnit`, high-water mark as before. |
| D-27 | 2026-09-13 | **Decided** | Coins are **decimal**. Stored as integer **milli-coins** (1 coin = 1,000 mc; 0.095 = 95 mc) so arithmetic is exact; API exposes `amount`/`balance` as decimal numbers with ≤ 3 decimals; UI shows 2. Client `coinTransactionSchema.amount` changes from `int()` to `number()`. Supersedes E1's "integers only" wording — the *storage* is still integer. |
| D-28 | 2026-09-13 | **Decided (owner)** | Backend stack: **Express** + TypeScript + Mongoose + MongoDB **Atlas** (local replica set via Docker for dev) + Redis + BullMQ. Folder `vokve-backend/` at the repo root. |
| D-29 | 2026-09-13 | **Decided (owner)** | **India only** at launch: `country = 'IN'`, Indian address format (6-digit PIN, state, +91), leaderboard scope IN, timezone default `Asia/Kolkata`. |
| D-30 | 2026-09-13 | **Decided (owner)** | Admin is **API only** — no admin UI. |
| D-31 | 2026-09-13 | **Decided (owner)** | SMS and email providers are added later. Until then OTP codes are **echoed in the response and logged** when `OTP_DEV_ECHO=true` (dev only, refused in production). Shop fulfilment also later; all rules still backend-enforced. |
| D-33 | 2026-09-14 | **Decided** | Backend is at `vokve-backend/` in this repo, Express + Mongoose; the client's `src/types/models.ts` is copied into `src/contracts/models.ts` (keep them identical — a sync script is a TODO). Passwords are bcrypt (cost 12) rather than Argon2id for now: no native build step on install; revisit before production. Access JWT is HS256 with `JWT_SECRET`; move to ES256 key pair before production (RULES Z1). |
| D-34 | 2026-09-14 | **Decided (owner)** | **Sign-up OTP goes to the email** (`otp.signupChannel = 'email'`) until an SMS provider exists; the other contact's code is sent automatically only if its channel can *really* deliver (`isChannelDeliverable`), never as a dev echo. Sign-in needs one verified contact; spending still needs both (RULES O5). Email delivery is SMTP via nodemailer (Gmail app password for dev); the OTP screen shows `devCode` in `__DEV__` builds. Purposes renamed: `signup` (channel-agnostic), `verify_phone` added. |
| D-35 | 2026-10-02 | **Decided (owner)** | Steps come from the owner's own package **react-native-step-tracker-pro** (≥ 2.4): the phone's `TYPE_STEP_COUNTER` in a foreground service, Health Connect **read-only** (steps, distance; never writes), fraud checks in `flag` mode, motion windows on, `gapRecovery: 'split'`, `wearableTrust: 'catalog'`, manual entries ignored. `react-native-health-connect` removed. Gaps are fixed in the package, not by adding another library. |
| D-36 | 2026-10-02 | **Decided** | **Ingest is one signed snapshot per device-day**, not a batch of samples: the tracker's `VerificationSnapshot` signed by a Keystore key the server holds the attested chain of. The server verifies the signature over the exact bytes, then trusts only what is inside — counts, sources, minutes, motion windows and raw records arrive under one signature. Supersedes the sample-batch example of BACKEND §15. |
| D-37 | 2026-10-02 | **Decided** | **Play Integrity is server-driven**: ingest answers `INTEGRITY_REQUIRED` (403, `details.cloudProjectNumber`) when the device's last verdict is older than ⚙ `integrity.playIntegrity.freshHours` (6), and the phone resends the same snapshot with a token bound to its hash. Keeps Play's 10k/day default quota out of the per-sync path; the per-snapshot Keystore signature still covers every upload. A phone that cannot get a token sends why, and still syncs (soft L0). |
| D-38 | 2026-10-02 | **Decided** | **Verified steps** = the best of the phone's own count less recovered and flagged steps, and an allowlisted (or tracker-catalog wearable) Health Connect source less manual and unknown-method steps — never added. A15's "> 2.0 → hard unverified" is applied to the *source*: one more than double the phone does not count, and the day falls back on the phone. Several devices: the best verified device's day, never a sum. |
| D-39 | 2026-10-02 | **Decided** | `activitySource` gains **`device`** (the phone's own sensor). Adding an enum member breaks installed clients (X2) — acceptable only because no client is in production yet; the client ships it in the same release. |
| D-40 | 2026-10-02 | **Decided** | A phone's tracker history belongs to the account that last used it: the client clears it and stops counting when a *different* account signs in on the same install, and stops counting on sign-out (not on session expiry). |
| D-41 | 2026-10-02 | **Decided (owner)** | **Nothing static in the app for steps**: Home, Analytics and Nutrition show the server's figures only (`/activity/weekly`, `/day`, `/range`); the phone's own live count appears only on the Step Tracking screen. Today syncs every ⚙ `activity.sync.intervalMinutes` (5) while the app is open, and on pull-to-refresh. The step goal and other settings come from `/me/settings`. |
| D-42 | 2026-10-02 | **Decided** | The tracker's set-up is served by `GET /activity/config` (⚙ `activity.tracker`, `activity.sync`) and applied on launch and each foreground; the app keeps a copy of the defaults only for a first launch with no connection. Record types are limited to those the manifest declares (`steps`, `distance`) — any other would void the Health Connect permission sheet. |
| D-43 | 2026-10-02 | **Decided** | `activity_daily.breakdown` stores each scored day's decision device by device and source by source; `GET /activity/sources` explains it. The fraud layers' scores and flags are shown only where ⚙ `activity.inspector.showChecks` allows (null = outside production): in production they would tell a cheater which check caught them. |
| D-44 | 2026-10-02 | **Decided (default; owner to confirm)** | **The streak lives on the server** (`modules/streak`, `GET /streak`, `POST /streak/freeze`, `POST /streak/restore`): `streak_days` (one row per counting day — earned, frozen or restored — written once, D2) and `streak_state` (freezes, grant keys). A day is earned by a plausible workout **or** verified steps at or above the user's own daily goal — ⚙ `streak.earnedBy` `{ workout: true, stepGoal: true }`. Steps are on by default because the app's only way to log a workout (WorkoutsScreen) is not reachable, and a streak nothing can earn would be a dead screen. The restore debit and the protected days are one transaction (`economy.debitInSession`); milestones are paid by `credit()` once each (ledger unique index), retried on the next change if a capped day granted nothing; freezes: 1 on sign-up, +1 per 30 days of one run, max 3 (⚙ `streak.freezes`); the 19:00 at-risk nudge is an hourly job. The profile card's streak figures come from the same module. |
| D-45 | 2026-10-02 | **Decided (owner: "nothing static")** | **No placeholder data in the app's caches.** The wallet, notification feed, shop catalogue and streak start empty and show a loading state (`LoadState`: spinner, then "Couldn't load … / Try again") until the server first answers; a stored cache that never synced (the old seed) is dropped by a persist migration. The shop's till rules (`ShopConfig`) are nullable until fetched — no copy of the server's defaults in the app. Seed data stays only for the mock API and tests. |
| D-46 | 2026-10-02 | **Decided (default; owner to confirm)** | **Challenges and achievements live on the server** (`modules/challenges`; `GET /challenges?date=`, `GET /achievements`). Catalogue in `challenge_definitions` (seeded from the app's board; `startsOn` set once, never moved by a re-seed), progress worked out from verified activity for the period a day falls in (daily / Monday-week / calendar month): verified steps, workout + verified walking calories, verified active minutes, streak-earned days, plausible workouts. Completion is automatic and once per (user, challenge, period) (`challenge_completions`), evaluated after each step rollup and workout save; coins through `credit()` (`source:'challenge'`, cap applies). **Anything steps can earn waits for step coins**: challenge rewards on step-derived metrics and streak milestones (when ⚙ `streak.earnedBy.stepGoal`) pay only once ⚙ `coins.steps.enabled` is on — the completion/achievement is recorded either way; milestones are paid on the next streak change after step coins open, a shadow-period challenge never is. Achievements: `achievement_definitions` with a rule (best day steps/calories/minutes, longest streak, total workouts, challenges completed) or none (a challenge's badge only); unlocked once into `user_achievements`; `value` is a number (C7). |
| D-47 | 2026-10-02 | **Decided** | **The leaderboard lives on the server** (`modules/leaderboard`; `GET /leaderboard`, `/leaderboard/history`, `/leaderboard/reward-tiers`). A member's week score is recounted into `leaderboard_scores` after every step rollup and workout save (verified steps, plausible workouts, challenges completed that week in the country's zone); ranks are score ↓, the time it was reached ↑, id ↑ (L5). The board shows first name + initial and the country, never more. An hourly job closes last week ⚙ `leaderboard.closeAfterHours` (6) into Monday: results frozen into `leaderboard_results` (L6), a place with an open hard fraud flag that week skipped and unpaid (L9), prizes paid through `credit()` exempt from the cap with `source:'challenge'` (E8d, E13) — and, being step-derived, only once ⚙ `coins.steps.enabled` is on (D-46). The prize table and the how-it-works text are worded by the server from ⚙ `leaderboard.tiers`/`score`. Gear (L8) is recorded on the result as `perks`; turning it into an order is not built. |
| D-48 | 2026-10-02 | **Decided** | **Water, its reminder plan and the app's standing words live on the server.** `modules/hydration`: `hydration_entries` (one row per drink, keyed by the app's own id so a retry is the same glass; local day fixed at write; soft delete) and `hydration_plans` (the whole plan, defaulted from ⚙ `hydration.defaultPlan` until changed). The app logs into a persisted **outbox** and shows the server's day with it laid over — water logging never waits on the network and survives being offline; a 404/422 drops a change, anything else waits. `modules/content`: `content_tips` per topic, one shown per day in the caller's zone (`GET /content/tips/:topic`) — Home's motivation line, the hydration, reminder, nutrition, health and vital tips; a tip the app has not got yet is simply not drawn. Reminder *delivery* (local or server push) is still not built. |
| D-49 | 2026-10-02 | **Decided** | **The food diary, targets, library and diet plan live on the server** (`modules/nutrition`). `food_entries` keyed by the app's own ids (a retried save is the same plate), local day fixed at write; `nutrition_profiles` (goals + preferences, defaults ⚙ `nutrition.default*`); `food_items` (global, `quickAdd` shortcuts, and member-private custom foods); `diet_plan_templates` (curated days tagged by diet type and meal plan — a member's plan cycles through the days that suit them, the N7 placeholder). The app saves meals into a persisted outbox and shows the server's day with it laid over; day and range reads re-run when the server confirms a change. The Nutrition screen's date chip now actually shows that day. The local diet-plan store and its per-date extras (never called) are gone. |
| D-50 | 2026-10-02 | **Decided** | **Vitals and the health score live on the server** (`modules/vitals`). `vital_readings` keyed by the app's ids (BMI never entered, V1; bounds ⚙ `health.bounds`), the newest weight keeps `User.weightKg` current (V4), BMI derived from it and the profile height (V3). `GET /health/score` is V8 with each part's points and a sentence, so the ⓘ can explain itself later; every answer carries the V9 wellness line. The app keeps the newest 60 readings plus an outbox; the score card shows the server's band word. With this, **no screen or store reads `seedData.ts` any more** — it serves only the mock API and tests (D-45). Also decided here: on a step rollup the day's **step coins are held before** the streak and challenge bonuses that follow from the same day, so bonuses take what the daily ceiling leaves rather than crowding the steps out (RULES E8). |
| D-51 | 2026-10-03 | **Decided (owner's report; coins part stays D-38)** | **A watch relayed by Google Fit is shown.** Google Fit writes Wear OS and many budget watches into Health Connect, but the tracker's catalog files it as a phone-side app, so under `wearableTrust: 'catalog'` it could only fill the hours before the phone began counting — a walk with only the watch never showed, and since the phone's own number did not move the day was never sent again. Now: ⚙ `activity.tracker.wearableAllowlist` (`com.google.android.apps.fitness`) makes the tracker use it whenever it counted more than the phone; the app re-sends a day when the best Health Connect app's count moves (`externalSteps` in the sync mark); the day's hours follow the app the phone showed; the sources page says why such steps are shown but not verified. **Verified is unchanged (D-38):** Google Fit stamps every step with no recording method — typed-in ones too — so with ⚙ `provenance.countUnknownMethod` off its steps never earn. Samsung Health (Galaxy Watch) is the same case; add it to the list to cover it. |
| D-52 | 2026-10-03 | **Decided** | **Health Connect is read sparingly: it rate-limits every call.** A test phone got "Rate limited request quota has been exceeded"; on Android 13 and older even the permission check is limited, and tracker 2.4.0 reads a refused check as "nothing granted", so Vokve looked disconnected and read nothing. The app now asks for the grants once a session (the tracker re-reads them on each foreground and reports a change), the Step Tracking screen shows the session's status instead of the tracker's `useHealthConnect` hook (which read every app's steps on each open, foreground and source change for a list the screen never showed), and a snapshot takes the session's grants instead of asking per day sent. The dev console report (`services/stepsDebug`, ⚙ `config.logStepSources`) reads once, at most once a minute. Package fixes reported to the owner: keep the last known grants when a check fails, recognise the rate limit and back off, cache a failed read briefly, read a snapshot's day once. |
| D-32 | 2026-09-13 | **Open — needs rebalancing** | With steps at ~9.5 coins per 10k-step day, the inherited defaults look out of proportion: workout **100**, 7-day streak **50**, referral 20/20, daily cap **300** (steps alone can never reach it). Owner should set `coins.workout`, `coins.streakMilestones`, `coins.dailyCap` deliberately. Defaults kept as inherited until then. |

## 3. Contradictions in the client, and their status

The client was built ahead of the rules, and a few numbers disagree with each other. **C1, C2 and C6 gate Phase 3; C5 gates Phase 5.** Update the status column when product decides.

| ID | Contradiction | Options | Status |
|---|---|---|---|
| C1 | 7-day streak pays **175** (wallet rate card) or **50** (milestone table). | Owner: backend-configurable. | **Resolved → config `coins.streakMilestones`**, default milestone table (7 d = 50); rate card served from `/wallet/earn-rules`, not hardcoded |
| C2 | Referral pays **300 to inviter** or **20 to each side**. | Owner decided. | **Resolved → 20 / 20**, both sides, on invitee's phone + email verification (config `coins.referral`) |
| C3 | 10K steps challenge pays **200** (definition) or **500** (seed ledger). | Definition wins; seed ledger is placeholder | **Resolved → 200** |
| C4 | `GET /activity/weekly` lacks `distanceKm`. | Additive schema change | **Resolved → add field** (BACKEND §4.3) |
| C5 | Leaderboard is composite (steps + workouts + challenges) but no formula exists. | Owner: "whatever a professional app does" → D-10 proposal adopted. | **Resolved → `steps/100 + workouts×50 + challenges×100`**, weights in config |
| C6 | Streak restore debited as `'purchase'`. | D-12 | **Resolved → `'streak'`** |
| C7 | `User.streakDays` vs client derivation. | Server wins; client reads `/streak` | **Resolved** |
| C8 | Pre-formatted strings (`"May 2025"`, `"12 May 2025"`, `"10K"`). | Send ISO / numbers | **Resolved** (BACKEND §4.3) |
| C9 | BMI entered manually. | D-11 | **Resolved** |
| C10 | Weight in three places. | D-11 | **Resolved** |
| C11 | Health score has no formula. | D-14 | **Open** |
| C12 | `Workout.startedAt` comment says nullable; schema says required. | Treat as required | **Resolved** |

## 4. Facts about the client that are easy to forget

- **Validation is strict.** Every response is zod-parsed; a missing key, an omitted `null`, or an unknown enum member throws `ApiError('validation')` and the screen errors. Send `null` explicitly. Never add enum members without a client release.
- **Retries are guaranteed.** `network`/`timeout` errors retry twice with 400/800 ms backoff. Every mutation must survive three identical calls → `Idempotency-Key`.
- **401 → one refresh → one replay.** Concurrent 401s share a refresh promise; rotate refresh tokens freely but always return a usable pair.
- **`profileCompletedAt` is the app gate.** Null → onboarding forever. Only `POST /me/complete-profile` sets it.
- **Sign-in has one identifier field** that accepts email or phone; the API method still calls it `email`.
- **Local midnight is everywhere.** `todayIso()` is local. Hydration, nutrition, streak, and analytics all bucket by the device's local day. The server needs `X-Vokve-Timezone`.
- **The wallet ledger is capped at 50 rows client-side** (`MAX_LEDGER_ENTRIES`); balance is stored, not summed, for that reason. Server keeps everything.
- **Notification filter counts are totals, not unread.** Deliberate.
- **Two dev flags** (`bypassAuthInDev`, `useMockApi`) are `__DEV__`-guarded and safe; CI should still assert them false on release branches.
- **Mock OTP is `123456`**; `MOCK_RULES` in `mockApi.ts` also has a `rejectedPassword` and a `takenMarker` for exercising error paths.
- **Steps on Android come from react-native-step-tracker-pro** (D-35): its manifest supplies the foreground service, boot receiver and the Health Connect rationale activity (opening the privacy policy); the app declares only `READ_STEPS` / `READ_DISTANCE`. iOS has nothing yet (`isSupported()` is false there).
- **Firebase packages are installed and unused.** Use FCM for push and Crashlytics for crashes; do not use Firebase Auth or Firestore (the ledger needs multi-document transactions and compound unique indexes — MongoDB, D-18).
- **`react-native-device-info@15` is installed and unused.** It provides `getUniqueId()` (vendor id), model/brand/OS, `isEmulator()`, `getVersion()`/`getBuildNumber()`. The client has **no device id of any kind** today.
- **`VerifyOtpScreen` takes no params** — the challenge lives in `authStore.pendingVerification`. Email OTP reuses it by setting a challenge with `channel:'email'`; the screen should read `channel`/`target` to change its copy.
- **The shop collects no shipping address.** Physical redemption needs a client screen and API in Phase 5.
- **`WorkoutsScreen` and `ProgressScreen` exist but are not routed** from any tab or root route.
- **Seed data is relative to today** (`daysAgo`, `dateDaysAgo`), so fixtures never look stale — replicate this in the staging seed script.

## 5. Numbers to remember (all ⚙ remote-config unless 🔒)

| Thing | Value | Source |
|---|---|---|
| Steps → coins | **0.095 per 100 steps** (config `coins.steps`) — was 10 / 1,000 on the client's rate card | D-26 |
| Workout | 100 | `EarnCoinsCard` |
| 7-day streak | config `coins.streakMilestones` — default 50 (C1 resolved) | |
| Referral | **20 / 20** both sides (C2 resolved) | |
| Streak milestones | 7/15/30/90/180 → 50/150/300/1,000/2,000 | `STREAK_MILESTONES` |
| Streak restore | 50 coins, within 7 days | `STREAK_RESTORE_COST`, `RESTORE_WINDOW_DAYS` |
| Coin idle expiry | 90 days, resets on credit | `COIN_EXPIRY_WINDOW_DAYS` |
| Leaderboard tiers | 1 → 5,000 + tee + bottle · 2–3 → 3,000 + tee + mat · 4–10 → 1,000 + mat | `REWARD_TIERS` |
| Leaderboard period | Mon–Sun, country-scoped, pays Monday | `LeaderboardHowItWorks` |
| **Daily coin ceiling (all sources)** | **300** ⚙ — owner wants 250–300; one config value | D-06, RULES E8 |
| Per-source daily caps | steps 200 · workout 100 · streak/challenge/referral 300 | RULES E8c |
| Daily step cap (tier) | 30,000 steps trusted/normal — but coin-wise clipped at 200 by the steps source cap | RULES T4, E8c |
| Monthly cap | off (null) | RULES E8e |
| Step goal | default 10,000; clamp 1,000–50,000 | `settingsStore` |
| Water goal | default 2,500 ml; clamp 500–8,000 | `settingsStore` |
| Rest timer | default 90 s; clamp 15–600 | `settingsStore` |
| Nutrition goals | 2,200 kcal / 120 P / 300 C / 70 F | `nutritionStore` |
| Nutrition prefs | vegetarian / balanced / gain_weight | `nutritionStore` |
| Vital bounds | HR 30–220; sys 60–250; dia 30–150; weight 20–350 | `AddReadingSheet` |
| HR bands | <60 low · 60–100 normal · 101–120 elevated · >120 high | `HEART_BANDS` |
| BP bands | high if sys≥130 or dia≥80; low if sys<90 or dia<60; elevated sys 120–129 | `pressureBandFor` |
| BMI bands | <18.5 · 18.5–24.9 · 25–29.9 · ≥30 | `BmiGuide` |
| Quiet hours | 22:00–07:00, on by default | `notificationSettingsStore` |
| Notification categories | 8, all on except `health` | `NOTIFICATION_CATEGORIES` |
| Hydration reminder presets | 07:00 08:30 10:00 · 13:00 15:30 · 18:00 20:00 · custom 11:00 21:30 | `remindersStore` |
| Client ledger cap | 50 rows 🔒 | `MAX_LEDGER_ENTRIES` |
| Client vitals cap | 60 readings 🔒 | `MAX_READINGS` |
| Password | 8–72, ≥1 letter, ≥1 digit 🔒 | `forms.ts` |
| Profile ranges | 90–250 cm, 25–300 kg 🔒 | `forms.ts` |
| Timeouts / retries | 15 s · 2 retries · 400 ms base 🔒 | `config.ts` |
| Access / refresh TTL | 15 min / 60 days | D-03 |
| OTP limits → client | `attemptsRemaining` on every wrong code; `retryAfterSeconds` + `Retry-After` on every 429 | RULES O1 |
| OTP | 6 digits · 5 min TTL · 5 attempts · 30 s resend · 3/h · 10/day per target, both channels | RULES O1 |
| Step-up OTP threshold | 1,000 coins | D-25 |
| Trust tiers | trusted ≥ 80 · normal 50–79 · watch 30–49 · restricted < 30 | RULES T2 |
| Hold windows | 24 h / 72 h / 7 d / manual | RULES T3 |
| Tier step caps | 30k / 30k / 15k / 5k | RULES T4 |
| Layer weights | L0 25 · L1 20 · L2 20 · L3 15 · L4 10 · L5 5 · L6 5 | RULES A20 |
| Pedometer mismatch | ratio outside 0.7–1.3 flag; > 2.0 hard | RULES A15 |
| Walking cadence band | 1.4–2.5 Hz; shake > 3 Hz | RULES A16 |
| Max devices / account | 5; flag at ≥ 3 accounts per device | RULES DV8 |
| Motion sampling | 10 s every 5 min while steps accrue | D-23 |
| Ingest window | today and the 7 days before, in the phone's zone ⚙ `activity.maxAgeDays` | RULES A8 — 2026-10-02 |
| Day verified at | score ≥ 50 ⚙ `activity.verifiedMinScore`, no hard flag | RULES A20 — 2026-10-02 |
| Active minute | ≥ 60 timed steps in the minute ⚙ `activity.activeMinuteSteps` | 2026-10-02 |
| Raw snapshot kept | 30 days, latest per device-day ⚙ `activity.rawSnapshotRetentionDays` | D-15 — 2026-10-02 |
| Play verdict fresh for | 6 h ⚙ `integrity.playIntegrity.freshHours` | D-37 — 2026-10-02 |
| Watch relays shown | `com.google.android.apps.fitness` ⚙ `activity.tracker.wearableAllowlist` | D-51 — 2026-10-03 |

## 6. Glossary

| Term | Meaning |
|---|---|
| **V-Coin / coin** | The in-app currency. Integer. Earned from verified activity, spent on goods. |
| **Verified** | A step/activity figure whose samples passed provenance and plausibility checks and whose batch passed attestation. Only verified activity mints coins or scores leaderboards. |
| **Provenance** | Where a health sample came from (`dataOrigin` / `sourceRevision`) and how it was recorded (`recordingMethod` / `wasUserEntered`). |
| **Attestation** | Play Integrity (Android) / App Attest (iOS) verdict that the app is genuine and the device untampered. |
| **Local day** | The calendar date in the user's device timezone. The unit for streaks, hydration, nutrition, step credit and daily challenges. |
| **Earned day / protected day** | A streak day from a plausible workout vs. one covered by a freeze or restore. |
| **Freeze** | Protects today without a workout. **Restore** bridges a gap up to yesterday for 50 coins. |
| **High-water mark** | `activity_daily.steps_credited` — how many steps have already been paid for that day, so incremental uploads never double-pay. |
| **Period** | One leaderboard week (Mon–Sun) in one country. **Snapshot** is its frozen final standings. |
| **Ledger row** | One signed coin movement with a source and a reference to the event that caused it. |
| **Compensating row** | A `refund` ledger row that reverses an earlier one. The only way to "correct" coins. |
| **Shadow mode** | Fraud scoring that records and dashboards but does not gate credit. |
| **Category** (notifications) | The 8 consent switches (what may be *sent*). Distinct from the 3 feed **filters** (how the feed is *read*). |
| **Slot** | A meal slot (`breakfast/lunch/snack/dinner`) or a reminder slot (`morning/afternoon/evening/custom`). |
| **Plausible workout** | ≥ 10 min, ≥ 1 completed set, sane loads. Only plausible workouts pay or mark streak days. |

## 7. Traps already found

1. **Treating `GET /activity/weekly` as sufficient for Home** — it lacks distance. Fixed by the additive schema change (C4).
2. **Counting orders from ledger rows** — breaks with refunds, multi-item orders, and streak restores. Orders are their own resource (R7).
3. **Two-step restore on the client** (`spend()` then `restore()`) — a race. Server does both in one transaction (S7).
4. **Deriving "is the user in onboarding" from filled fields** — a user who leaves weight blank would loop forever. Use `profileCompletedAt` only (P1).
5. **Rolling 30-day "month"** — the wallet says "this month"; use the calendar month (E12).
6. **Unread counts on filter chips** — the client deliberately shows totals (M7).
7. **Recomputing `local_day` later** — a paid day must never move buckets when a user travels (A3, D2).
8. **Paying leaderboards from a live query** — pay from the frozen snapshot (L6).
9. **Adding an enum member server-side** — breaks every installed client (X2).
10. **Using Firestore for the ledger** — no multi-document transactions with compound unique constraints; use MongoDB with a replica set (D-18).
11. **Unique indexes on time-series collections** — MongoDB does not support them; raw samples live in a regular collection, the time-series copy is analytics-only.
12. **Trusting `isEmulator()` alone** — it is a client-reported flag; attestation is the real check. Use the flag as an L0 signal, attestation as the gate.
13. **Crediting step coins directly** — every clawback is a support conversation. Hold first, release after the window, void silently-but-visibly (D-21).
15. **Import cycles hidden behind `await import()`** — Jest here does not transform dynamic import, so the code under test never ran. The client injects what it needs from `device.ts` through setters (`setRequestHeadersProvider`, `setDeviceReregistrar`), the same pattern as `setOnSessionExpired`; all app imports are static.
16. **Signing a user out because the server was unreachable** — a launch-time network error is not a revoked session. `unreachable` keeps the tokens and shows a retry.
14. **One OTP purpose verifying another** — an email code must never complete a phone challenge; `purpose` is part of the lookup (RULES O2).
17. **Keying a retryable request's idempotency on its content** — `idempotent` stores 4xx answers too, so an ingest keyed by the snapshot hash would replay its own `INTEGRITY_REQUIRED` to the resend with a token. The client sends a fresh key per attempt; the server dedupes the snapshot on its hash.
18. **Trusting Google's attestation root by certificate** — the RSA root has been re-issued four times with the same key, and one of the re-issues in old phones has expired. Roots are trusted by SPKI hash; the root's dates are never checked (neither is the leaf's, which comes from the phone's clock).
19. **`@peculiar/asn1-*` octet strings** — fields typed `OctetString` come back as an `OctetString` instance or a bare `ArrayBuffer` depending on how the schema declares them (`AttestationPackageInfo.packageName` is the latter). `keyAttestation.ts` reads both.
20. **Health Connect "disconnect" on Android 14+** — `PermissionController.revokeAllPermissions()` is `Context.revokeSelfPermissionsOnKill()` there: nothing changes until the app's process dies, the status still reads granted, and a grant made in between is undone at that kill — so "connect, swipe the app away, disconnected again". The app offers no in-app disconnect on 14+; Health Connect's own settings revoke at once.

## 8. How to update this file

- Add a `D-nn` row for every decision that changes behaviour, with the date and the doc it lands in.
- Move a contradiction to **Resolved →** with the chosen option the day product decides.
- When a ⚙ value changes in production, note the date and old→new in §5.
- When you find a trap, add it to §7 with one line on how it was avoided.
- When a fraud layer weight or threshold changes in production, add a dated line under §5 with old → new and the reason.
- Keep §1 to one screen. If it grows, the docs it points at need the detail, not this section.
