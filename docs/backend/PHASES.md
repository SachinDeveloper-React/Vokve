# VOKVE Backend — Delivery Phases

**Version:** 1.1 (MongoDB) · **Related:** [BACKEND.md](../BACKEND.md) · [PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [RULES.md](RULES.md) · [MEMORY.md](MEMORY.md)

Six phases, roughly 18–22 engineering weeks for a team of two backend engineers plus part-time client work. Each phase has a **gate** — a demonstrable outcome — and lists the PRD requirement ids it discharges. Phases 2 and 3 are deliberately separated: **watch real step data before minting coins from it.**

```
P0 Foundations ─► P1 Existing contracts ─► P2 Steps (observe) ─► P3 Economy ─► P4 Engagement + wellness ─► P5 Rewards + commerce ─► P6 iOS + hardening
   1 wk              2–3 wk                   3–4 wk               3–4 wk         4 wk                          3–4 wk                     2–3 wk
```

---

> **Status 2026-09-14:** Phase 0 complete; Phase 1 complete except SMS/email providers, social sign-in, avatar, addresses, deletion/export; the economy module (Phase 3 core: ledger, caps, escrow, wallet) was pulled forward because the daily cap was an explicit owner requirement. See MEMORY.md §1a.

## Phase 0 — Foundations (1 week)

**Goal:** a deployable skeleton with the cross-cutting pieces every later phase depends on.

**Work**
- Monorepo: `apps/api`, `apps/worker`, `packages/contracts` (client zod schemas copied in with a sync script), `packages/db`, `packages/core`.
- Fastify + zod type provider; request lifecycle plugins from ARCHITECTURE §4: requestId, otel, auth stub, header capture, rate limit, idempotency, error mapper.
- MongoDB (Atlas dev cluster; local `mongodb-memory-server` replica set) + Redis; Mongoose models with declared indexes and `$jsonSchema` validators for `users`, `refresh_tokens`, `otp_challenges`, `devices`, `app_releases`, `idempotency_keys`, `audit_log`, `app_config`, `feature_flags`, `events`.
- **Device registration** (`POST /devices/register`, heartbeat, `X-Vokve-*` header capture, 428/426 gates) and `GET /releases` — every later phase depends on device attribution.
- `POST /events` analytics sink.
- CI: typecheck, lint, unit, integration on a memory replica set, index/validator drift check, migration dry-run, release-flag assertion (RULES Q2).
- Staging environment at `api.staging.vokve.app` with TLS.
- `GET /health`, `GET /config` (static values from `app_config`).
- Observability: structured logs, traces, the metric names from ARCHITECTURE §9 registered (even if zero).

**Gate:** `curl https://api.staging.vokve.app/v1/health` → 200; a request with a bad body returns the client's `ApiError` shape; a request without a registered device id returns 428; CI green.

**Discharges:** X1, X2, X3, D1–D6, ADV2, ADV3.

---

## Phase 1 — Make the existing contracts real (2–3 weeks)

**Goal:** the client runs on the real API with `useMockApi: false` and **zero client changes** for the four existing groups.

**Work**
- **Auth:** sign-up → phone OTP (SMS provider integrated, sandbox in staging), verify, resend, sign-in by email *or* phone, sign-out, refresh with rotation **bound to device**. `otp_challenges` (channel + purpose) stores the pending sign-up payload so the account is created only on verification.
- **Email OTP:** auto-created after phone verification; `POST /auth/email/send-otp`; polymorphic `verify-otp`; `emailVerifiedAt`. Soft gate (D-20) — enforced on spend/payout paths from Phase 3. Passwordless OTP login and OTP-based password reset ride on the same mechanism.
- **Devices:** `GET/DELETE /me/devices`, new-device notification (feed row now, push in Phase 4), max-devices cap, version stats job.
- **Profile:** `GET /me`, `PATCH /me`, `POST /me/complete-profile` (sole setter of `profileCompletedAt`). Add `createdAt`, `country` (derived from dial code).
- **Workouts:** `GET /workout-templates` and `GET /exercises` seeded from `seedData.workoutTemplates`; `POST /workouts` idempotent upsert with server-side volume recompute (**no coins yet**); `GET /workouts` — wrap in `{data,nextCursor}` and land the one-line client change.
- **Activity:** `GET /activity/weekly` and `/activity/today` returning **zeros** with `verified:false` until Phase 2 — honest, and it unblocks the client's schema change (`distanceKm`, `source`, `verified`).
- **Settings + notification preferences:** `GET/PUT /me/settings`, `GET/PUT /me/notification-preferences` — trivial, and they let the client stop treating MMKV as the source.
- **Devices:** `POST /devices` for FCM tokens (no sending yet).
- **Account deletion + export** skeleton (`DELETE /me` anonymises; export is a queued job producing a JSON file).
- Contract tests: every response validated against `packages/contracts`.

**Client work:** set `useMockApi:false` in staging builds; generate `installId`, call `/devices/register` on launch, add the seven `X-Vokve-*` headers using `react-native-device-info`; email-OTP step reusing `VerifyOtpScreen` with `channel`; accept the additive schema fields; `/workouts` envelope.

**Gate:** sign up on a real phone, receive an SMS, verify, receive an email code, verify, complete profile, land on Home, finish a workout, kill the app, relaunch, see the workout in history — all against staging; the device appears in `GET /me/devices` with model and app version; revoking it from another device signs it out. `mockApi.ts` still exists but is not exercised.

**Discharges:** A1–A7, A10–A14, A16, P1, P3, P4, W1, W2, W3, W5, M3, X3, D7–D10, ADV13, ADV15 (deletion/export skeleton).

---

## Phase 2 — Steps, honestly (3–4 weeks)

**Goal:** real step data flows from Android devices into `activity_daily`, is provenance-checked and plausibility-scored, and is visible in the app — **without minting a single coin**.

**Work**
- **Client (Android):** wire `react-native-health-connect` — permission request flow (rationale activity exists), read steps/distance/active-calories since cursor with full metadata, batch, queue offline, `POST /activity/ingest` on foreground + 15-min background task. Play Integrity token attached.
- **Client (both):** read the OS pedometer counter for the same window (L3) and sample accelerometer features 10 s per 5 min while steps accrue (L4) — features only.
- **Server:** `POST /activity/ingest` per ARCHITECTURE §5.3: attestation verify (permissive flag) + device signals (L0), dedupe, provenance allow/deny lists (L1), raw `activity_samples`, `motion_windows`, debounced rollup job → `activity_daily` (with `pedometerSteps`, hourly).
- **All eight fraud layers** (RULES A14–A20) computing per-layer scores, `plausibility` and `flags`; trust score + tier (RULES §T) — **shadow mode**: stored, dashboarded, not enforced.
- `GET /activity/today`, `/weekly`, `/range?granularity=hour|day|week|month` — replaces `todayActivity`, `weeklySteps`, `todayHourlySteps`, `monthlyStepsByWeek`, `yearlyStepsByMonth`. Home and Analytics go live.
- `health_connections` CRUD; Account → "Health Data" row gets a screen.
- Fraud dashboard: score distribution per layer, flag counts, tier distribution, top accounts by steps, device-sharing view, pedometer-mismatch and motion-class histograms, fraud-by-app-version.
- `fraud_flags` table and nightly `fraudSweep` (shadow).

**Gate:** 2 weeks of production Android data with ≥ 60% of DAU connected; dashboard shows score distribution; product signs off on initial thresholds from real numbers.

**Discharges:** S1–S9, S12–S15 (shadow), S19, D8, D9, ADV17.

---

## Phase 3 — Move the economy to the server (3–4 weeks)

**Goal:** coins are minted, held and spent only on the server. Client `coinsStore` becomes a cache. This phase closes the vulnerability in BACKEND.md §1.

**Prerequisites (hard gate):** contradictions **C1, C2, C6** resolved and recorded in MEMORY.md; coin rate cost model signed off; Phase 2 thresholds and tier windows chosen from shadow data.

**Work**
- `economy` module: `coin_ledger`, `coin_balances`, `coin_holds`, `coin_daily_caps`; `credit()`, `hold()`, `release()`, `debit()` as MongoDB transactions with conditional `$inc` and unique-index idempotency; per-source, per-tier and global caps (RULES E1–E8, E15–E16, §T).
- **Escrow:** step rollups create holds; `releaseHolds` job; void on new flags; `pending` on the wallet.
- **Daily coin ceiling:** `coins.dailyCap` (300) enforced atomically in `credit()/hold()` via `coin_daily_caps`; per-source caps; `dailyCap / earnedToday / remainingToday` on `/wallet`; property test: no sequence of events can exceed the cap in one local day.
- **Email/phone verification gates** on spend paths (RULES O5).
- Earn wiring: steps high-water mark in the rollup job (A4); workout 100 with plausibility minimums (W4–W5); streak restore debit as `streak` (E13).
- `GET /wallet`, `/wallet/transactions`, `/wallet/earn-rules`; rates read from `app_config`.
- Expiry: `expiryWarn` (14 d, 3 d) and `expirySweep` jobs (E9–E11); `expiresAt` in `/wallet`.
- Nightly `reconcile` with drift alert (E3).
- Ledger property tests (ARCHITECTURE §10) — required for merge.
- Admin API: fraud review queue (confirm/dismiss/void/clawback/tier/ban/appeal), user 360 (devices, ledger, holds, flags, samples), freeze account.
- **Turn on enforcement**: attestation strict in production; shadow mode off — tiers set hold windows and caps; `verified` drives holds.
- Welcome bonus decision (seed ledger has a 605-coin "Welcome bonus") — implement as a one-off `challenge` credit if kept.

**Client work:** `coinsStore` → cache of `/wallet`; remove `earn()`/`spend()` local mutations; Wallet, Shop badge, Streak restore, Account read from server; delete `seedCoinTransactions`.

**Gate:** a user who earns 300 coins in a day gets **0** from the next event that day and sees "Daily limit reached"; a user walks 6,000 verified steps and sees **60 pending coins** within an hour and **+60 credited** after the tier window; the same batch re-uploaded holds nothing; a shaken phone's steps are shown but held then voided with a visible reason; an emulator cannot register a trusted device; a user without a verified email is refused at redeem with a clear message; nightly reconciliation reports 0 drift for 7 consecutive nights.

**Discharges:** C1–C9, W4, W6, S4, S12–S18 (enforced), A12, A15, T-series, O5, ADV4 (queue), ADV8 (fraud + user 360), ADV14.

---

## Phase 4 — Engagement and wellness (4 weeks)

**Goal:** streaks, challenges, notifications, hydration, nutrition and vitals are server-owned. Every remaining seed export except shop/leaderboard/referral is deleted.

**Work — streak**
- `streak_days`, `streak_freezes`, `streak_milestones_paid`; port `currentStreakOf`/`longestStreakOf`/`restoreGapOf` with the golden tests.
- `GET /streak`, `POST /streak/freeze`, `POST /streak/restore` (atomic with `economy.debit`), `GET /streak/milestones`; milestone payouts (S8).
- Midnight `evaluate` job; streak-at-risk push (S10).

**Work — challenges & achievements**
- `challenge_definitions` seeded from `seedChallenges`; auto-enrol (C5); progress recompute job from `activity_daily` + workouts; `POST /challenges/:id/claim` → `economy.credit`; `achievements` + `user_achievements`; `GET /achievements` with numeric `value`.

**Work — sync & messaging**
- `POST /sync` for hydration/food/vitals with `clientId` upsert (ADV1).
- `notifications` feed, `GET /notifications`, `/counts`, read endpoints; `messaging.dispatch` worker with category map, quiet hours, FCM send; SMS hook for orders (used in Phase 5).
- Notification producers wired for: steps milestone, workout saved, streak at risk, coins **released**, hold voided (with reason), challenge complete/claimable, coin expiry warnings, new device sign-in.
- Push campaigns to segments (ADV4) and the weekly insights digest (ADV5).

**Work — hydration**
- `hydration_entries`, `/hydration/today|entries|days|stats`; `hydration_reminders` + `PUT`; reminder dispatch respecting `health` category and quiet hours. Client keeps local notifications as the primary channel; server sends only when the app has not been foregrounded that day.

**Work — nutrition**
- `food_items` (seed from `foodLibrary`, full-text search), custom foods; `food_entries` batch + delete; `/nutrition/day|days|goals|preferences`; `planned_meals` with user additions; plan generation job (start with curated templates per `(dietType, mealPlan)` — the seed rotation becomes the first template set).

**Work — vitals**
- `vital_readings` with bounds and bands (V1–V7); BMI derived; weight → profile (V4); `/vitals/*`; `health_scores` daily job with factor breakdown (V8); `GET /health/score`.

**Client work:** each store becomes a cache with an offline write queue for user-created entries (hydration, food, vitals); delete `seedStreak`, `seedChallenges`, `seedAchievements`, `seedNotifications`, `hydrationHighlights`, `seedVitals`, `healthHighlights`, `seedFoodEntries`, `foodLibrary`, `dietPlanRotation`, `profileHighlights`.

**Gate:** a fresh install with no MMKV state shows the same Home, Streak, Challenges, Notifications, Hydration, Nutrition and Health screens the seed used to produce — from the server; a push arrives for "streak at risk" at 19:00 local and is suppressed during quiet hours.

**Discharges:** K1–K7, H1–H5, M1–M5, Y1–Y5, N1–N6, V1–V5, P2, P5, ADV1, ADV4, ADV5.

---

## Phase 5 — Rewards and commerce (3–4 weeks)

**Goal:** the leaderboard pays real prizes and the shop ships real goods.

**Work — leaderboard**
- `leaderboard_periods`, Redis live scores, `rescore` job with formula L3, `close` + `pay` jobs (Monday per country), `leaderboard_snapshots`, tie-break L5, fraud exclusion L9, merch perk orders L8.
- `GET /leaderboard` with `me` block and `isCurrentUser`, `/leaderboard/history`, `/leaderboard/reward-tiers` from `reward_tiers`.

**Work — shop & orders**
- `shop_items` + `shop_inventory` seeded from `shopItems`; product images in object storage; `GET /shop/items`.
- `addresses` CRUD — **plus the client address screen that does not exist**.
- `POST /shop/redeem` MongoDB transaction (R2–R4) with **KYC-lite preconditions** (verified email + phone + address + trust ≥ normal) and **step-up OTP** above 1,000 coins (ADV7, ADV12); `orders` with embedded items/events; `GET /orders`, cancel (R6); order-state notifications (push + SMS if opted in); inventory alerts.
- Fulfilment admin: list placed orders, transition states, add tracking — low-code UI over the admin API.

**Work — referrals**
- `referral_codes` on sign-up; deep links `vokve.app/r/CODE` with deferred attribution on first device registration (ADV6); `POST /referrals/apply`; qualification hook on first plausible workout (F3); payout via `economy.credit` both sides per decision; caps and ring detection (F4–F5); `GET /referrals/me`. Client sign-up form gets an optional code field.

**Client work:** Shop, Leaderboard, Referral, Orders screen (new), Address screen (new); delete `shopItems`, `seedLeaderboard`, `leaderboardHighlights`, `seedReferrals`, `referralCode`, `REFERRAL_REWARD_COINS`. **`seedData.ts` is now empty and deleted.**

**Gate:** a Monday close pays the top ten from a frozen snapshot and creates merch orders; a redemption with stock 1 under 50 concurrent attempts produces exactly one order; a referral pays exactly once when the invitee finishes a workout; `seedData.ts` no longer exists.

**Discharges:** L1–L7, R1–R7, F1–F5, P6, M6, A15, ADV6, ADV7, ADV12.

---

## Phase 6 — iOS parity and hardening (2–3 weeks)

**Work**
- **HealthKit:** entitlement, App Attest device registration, `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription`, `HKObserverQuery` + background delivery, App Attest, App Store review note. Same ingest endpoint; `wasUserEntered` and `sourceRevision` provenance.
- Vitals ingestion from both providers (V10); Apple Watch as trust bonus.
- Social sign-in (Google, Apple — required on iOS if any social login is offered — Facebook); forgot/reset password.
- Fraud thresholds re-tuned on iOS data; clawback tooling exercised end-to-end.
- Load test: ingest at 10× target, redeem contention, leaderboard close for 100k users.
- Penetration test of `/auth/*`, `/activity/ingest`, `/shop/redeem`, admin API.
- Certificate pinning on the client for auth + ingest + device registration.
- SSE stream for wallet/leaderboard (ADV10, optional); data lifecycle automation complete (ADV9); streak insurance behind a flag (ADV11).
- Runbooks: reconciliation drift, SMS provider outage, FCM outage, stuck leaderboard close, fraud clawback.

**Gate:** iOS and Android users on the same country board with comparable verified-step coverage; pen-test findings closed; on-call runbooks reviewed.

**Discharges:** A8, A9, S10, V10, Z-series, ADV9–ADV11.

---

## Cross-phase tracks

| Track | Runs through | Notes |
|---|---|---|
| Contradiction resolution | P1 → P3 gate | C1, C2, C6 block Phase 3; C5 blocks Phase 5; the rest are absorbed in Phase 1/4 schema work |
| Remote config | P0 onward | Every ⚙ value in RULES.md lands in `app_config` the phase it is first used |
| Device attribution | P0 onward | `deviceId` + version on every log, ledger row, flag and audit entry from the first endpoint |
| Fraud layers | P2 shadow → P3 enforced → P6 retuned on iOS | Weights/thresholds only via config, dated in MEMORY.md |
| Admin surface | P3 onward | Admin API first; low-code UI; never a hand-built front-end before Phase 6 |
| Client cache migration | P1 → P5 | One store per phase; each ends with a `seedData` export deleted |
| Compliance | P1 (deletion/export), P2 (Health Connect policy), P6 (HealthKit) | |

## Definition of done (every phase)

- Endpoints documented in BACKEND.md §6 with the [E]/[N] marker updated.
- Contract tests pass against `packages/contracts`.
- Idempotency tests for every new mutating endpoint.
- Dashboards and alerts for every new metric.
- MEMORY.md updated with decisions taken and questions closed.
- The corresponding `seedData.ts` exports deleted from the client.
