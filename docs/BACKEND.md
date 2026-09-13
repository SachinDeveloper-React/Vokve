# VOKVE — Backend Specification

**Status:** Draft v1 · derived from the React Native client at commit `2e4170e`
**Audience:** Backend engineers building the Vokve API from scratch
**Client stack:** React Native 0.87.1 · React 19.2.3 · TypeScript · zod · zustand (MMKV persist) · axios · React Navigation

---

## 1. What this document is

The Vokve mobile client is **fully built and navigable, with no backend behind it**. Every screen renders, but roughly two thirds of what it renders comes from `src/constants/seedData.ts` or from client-only zustand stores persisted to MMKV.

This document reverse-engineers the API the client already expects, specifies the endpoints it still needs, and defines the server-side rules for the parts of the product that **cannot safely stay on the device** — above all the coin economy and step counting.

It is written to be implementable without reading the app, but every claim is anchored to a file so you can check it.

### The one thing to read if you read nothing else

> **Coins are currently minted on the device.** `src/stores/coinsStore.ts` holds the balance, the lifetime total and the ledger in MMKV — which is **plain-text, unencrypted storage** (see the comment in `src/services/secureStorage.ts`). Coins buy physical goods (t-shirts, bottles, mats) through the shop and the leaderboard tiers. Anyone with a rooted or jailbroken device, or a file-system backup, can give themselves 500,000 coins today.
>
> The client store must become a **read-through cache of a server-authoritative ledger**. Section 8 specifies that ledger; section 7 specifies the step verification that has to sit in front of it, because steps are the primary way coins are minted.

---

## 2. Current state audit

### 2.1 What the client already calls

Four API groups exist, declared as interfaces in `src/services/api/contracts.ts` and implemented twice — once against HTTP in `src/services/api/endpoints.ts`, once in-memory in `src/services/api/mockApi.ts`. Both implementations satisfy the same TypeScript interface, which is what keeps the mock honest.

| Group | Endpoints | Returns |
|---|---|---|
| `AuthApi` | `POST /auth/sign-in`, `POST /auth/sign-up`, `POST /auth/verify-otp`, `POST /auth/resend-otp`, `POST /auth/sign-out` | `AuthResponse`, `VerificationChallenge` |
| `UserApi` | `GET /me`, `PATCH /me`, `POST /me/complete-profile` | `User` |
| `WorkoutApi` | `GET /workout-templates`, `GET /workouts?cursor=`, `POST /workouts` | `WorkoutTemplate[]`, `Workout[]`, `Workout` |
| `ActivityApi` | `GET /activity/weekly` | `DailyActivity[]` |

Plus one endpoint called directly by the HTTP layer and not part of any interface:

| | |
|---|---|
| `POST /auth/refresh` | `{ refreshToken }` → `AuthTokens`. Called from `src/services/api/client.ts` with a bare axios instance, deliberately bypassing the app's own interceptors so a failed refresh cannot recurse. |

**Everything else in the product has no endpoint at all.**

### 2.2 What is faked, and where

`src/constants/seedData.ts` (686 lines) is consumed directly by seven screens. Each export is a backend feature that does not exist:

| Seed export | Screen | What it stands in for |
|---|---|---|
| `weeklySteps`, `todayActivity` | Home | Step, distance, active-minute and calorie history from a health data source |
| `profileHighlights` | Account | Level, tier title, join date, achievement count, lifetime steps |
| `seedCoinTransactions` | Wallet, Shop | The coin ledger |
| `shopItems` | Shop | The reward catalogue |
| `seedNotifications` | Notifications | The notification feed |
| `seedChallenges`, `seedAchievements` | Challenges | The challenge engine |
| `seedLeaderboard`, `leaderboardHighlights` | Leaderboard | Ranking and prize history |
| `hydrationHighlights` | Hydration | Water history beyond today |
| `seedStreak` | Streak (via store) | Training-day history |
| `workoutTemplates` | Workouts | The exercise/template catalogue |

Three more sets of product rules are hardcoded in components rather than seeded. These are arguably correct to keep client-side for instant render, but **the server must hold the same numbers and be the one that pays out**:

- `STREAK_MILESTONES` in `src/components/streak/StreakBenefitsCard.tsx` — 7d→50, 15d→150, 30d→300, 90d→1000, 180d→2000 coins
- `REWARD_TIERS` in `src/components/leaderboard/RewardTiersCard.tsx` — rank 1 → 5,000 coins + t-shirt + bottle; ranks 2–3 → 3,000 + t-shirt + mat; ranks 4–10 → 1,000 + mat
- The earn rate card in `src/components/wallet/EarnCoinsCard.tsx` — 10 coins per 1,000 steps, 100 per workout, 175 per 7-day streak, 300 per referral

### 2.3 Native capability already provisioned but not wired

| Capability | Provisioned | Wired in JS |
|---|---|---|
| Health Connect (Android) | Yes — `react-native-health-connect@4.1.3`, `HealthConnectPermissionDelegate` in `MainActivity.kt`, `PermissionRationaleActivity.kt`, and `READ_STEPS` / `WRITE_STEPS` / `READ_HEALTH_DATA_IN_BACKGROUND` in `AndroidManifest.xml` | **No** |
| HealthKit (iOS) | **No** — no `NSHealthShareUsageDescription` or `NSMotionUsageDescription` in `Info.plist`, no HealthKit entitlement | No |
| Firebase (auth, messaging, crashlytics, perf) | Yes — all four packages installed, `firebase.json` present | **No** — zero `firebase` imports anywhere under `src/` |
| Google / Apple / Facebook sign-in | Partly — `react-native-nitro-google-signin`, `react-native-fbsdk-next` installed; `SocialAuthRow` renders all three buttons | **No** — handlers are no-ops |

This matters for sequencing: Android step ingestion is the shortest path to a working steps feature, and iOS needs an entitlement request and an `Info.plist` change before it can read anything.

### 2.4 Contradictions the backend must resolve

Found while auditing; each needs a product decision before the ledger is authoritative:

1. **7-day streak pays two different amounts.** `EarnCoinsCard` advertises **175** coins for "every 7 days in a row"; `STREAK_MILESTONES` pays **50** at the 7-day mark. The seeded ledger row ("7 day streak bonus", +175) sides with the rate card. Decide whether milestones are one-off lifetime awards or a repeating 7-day bonus — they cannot be both at these numbers.
2. **10K steps challenge pays two different amounts.** `seedChallenges.ch-10k-steps.rewardCoins` is **200**; the seeded ledger row for the same challenge is **+500**.
3. **`GET /activity/weekly` cannot feed the Home screen.** `dailyActivitySchema` has `steps`, `activeMinutes`, `caloriesBurned`, `workoutsCompleted` — but **no `distanceKm`**, which `ActivityMetricsRow` requires. Section 6.1 adds it.
4. **`User.streakDays` duplicates the client streak store.** The model comment already concedes this ("the user record's `streakDays` is the server's number for the same thing; this store is the client's"). Once streaks are server-side, one of the two must go — recommendation: keep the server's, delete the store's derivation.
5. **Pre-formatted strings in place of data.** `profileHighlights.memberSince` is `"May 2025"`, `leaderboardHighlights.bestRankAchievedOn` is `"12 May 2025"`, and `Achievement.value` is `"10K"`. The API should send ISO dates and raw numbers; the client already has `src/utils/format.ts` to render them.
6. **`Workout.startedAt` doc comment is stale.** It reads "Null while the session is still in progress" but the schema is non-nullable. Treat `startedAt` as required and `completedAt` as the in-progress signal.

---

## 3. Transport contract

These are not proposals — they are what `src/services/api/client.ts` already does. The server has to fit them.

### 3.1 Base URL and versioning

```
dev / staging  https://api.staging.vokve.app/v1
production     https://api.vokve.app/v1
```

Version is in the path. Breaking a response shape requires `/v2`, because the client validates every response against a zod schema and **rejects anything that does not match** (see 3.5) — an additive field is safe, a renamed or removed one is a hard client-side failure.

### 3.2 Authentication

Bearer access token, attached by a request interceptor to every call:

```
Authorization: Bearer <accessToken>
```

`AuthTokens` is `{ accessToken, refreshToken, expiresAt }` where `expiresAt` is **epoch milliseconds**. Tokens are stored in the iOS Keychain / Android Keystore via `react-native-keychain`, never in MMKV.

**Refresh flow, exactly as implemented:**

1. Any response with **401** triggers one refresh attempt (`POST /auth/refresh` with `{ refreshToken }`).
2. Concurrent 401s share a single in-flight refresh promise — the client will never fire two refreshes at once. **You may therefore rotate refresh tokens**, but the response must always return a usable pair.
3. On success the original request is replayed once with the new access token. A second 401 on the replay is final.
4. On failure the client clears the Keychain and flips the session to `signed_out`.

Recommended token lifetimes: access **15 minutes**, refresh **60 days**, rotated on every use with a short (~30s) grace window for replayed requests.

### 3.3 Errors

`src/services/api/errors.ts` maps status codes to a discriminated `ApiErrorKind` the UI branches on:

| Status | `kind` | Retried? |
|---|---|---|
| 401 | `unauthorized` | No — triggers refresh |
| 403 | `forbidden` | No |
| 404 | `not_found` | No |
| 422 | `validation` | No |
| ≥500 | `server` | No |
| transport failure | `network` | **Yes** |
| timeout | `timeout` | **Yes** |

Error body shape — the client reads `message` from the response when present, otherwise falls back to its own copy:

```json
{
  "error": {
    "code": "OTP_INVALID",
    "message": "That code is not right. Check it and try again.",
    "details": { "attemptsRemaining": 2 }
  }
}
```

`message` must be **end-user readable** — it is rendered directly in the UI. Put developer detail in `code` and `details`.

Use **422** for field-level validation failures, with `details` keyed by field name so forms can attach errors to inputs:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Check the highlighted fields.",
  "details": { "email": "That address is already registered." } } }
```

### 3.4 Timeouts and retries

```
requestTimeoutMs   15000
maxRetries         2
retryBaseDelayMs   400   (exponential: 400ms, 800ms)
```

Only `network` and `timeout` retry. **4xx is never retried.** Consequence for you: every mutating endpoint must tolerate being called up to three times for the same intent — see 3.6.

### 3.5 Response validation is strict

Every response is parsed through a zod schema in `src/services/api/endpoints.ts` before it reaches a store. A mismatch throws `ApiError('validation')` and the screen shows an error — it does **not** degrade gracefully.

Practical rules:
- Send `null` explicitly for absent nullable fields. Do not omit the key.
- Never send `undefined`, and never send a string where a number is declared.
- Dates are **ISO-8601 with timezone** (`2026-09-13T10:24:00Z`) for timestamps, and **`YYYY-MM-DD`** for calendar dates (`DailyActivity.date`, streak days, challenge `startsAt`).
- Enums are closed. Adding a `CoinSource`, `NotificationTopic`, `ChallengeMetric`, `ShopBadge` or `ShopCategory` value **breaks every client in the field**. New enum values ship behind a client release, or as an `"other"` member added now.

### 3.6 Idempotency

Required on every coin-moving or order-creating endpoint, because of the retry policy in 3.4:

```
Idempotency-Key: <client-generated uuid v4>
```

Store the key with the response for at least 24 hours and replay the stored response on a repeat. Applies to: workout save, activity ingest, shop redemption, challenge claim, streak freeze, streak restore, hydration log.

### 3.7 Pagination

The one paginated endpoint that exists uses an opaque cursor (`GET /workouts?cursor=`). Keep that shape everywhere:

```json
{ "data": [ ... ], "nextCursor": "eyJpZCI6..." }
```

`nextCursor` is `null` on the last page. **Note:** `workoutApi.history()` currently expects a bare array, not an envelope — either wrap it and update the client schema, or keep `/workouts` bare and use the envelope for new endpoints only. Recommendation: **wrap it now**, while there is no production client to break.

### 3.8 Required request headers

The client should send these on every call (not yet implemented — add alongside the backend):

```
X-Vokve-Platform: ios | android
X-Vokve-App-Version: 1.0.0        // config.appVersion
X-Vokve-Device-Id: <stable install id>
X-Vokve-Timezone: Asia/Kolkata     // IANA; required for daily rollover, see 8.4
```

Timezone matters more than it looks. Streaks, daily challenges, hydration rollover and step-day boundaries are all **local-midnight** concepts; the client already computes `today()` in local time (`src/stores/hydrationStore.ts`, `src/utils/date.ts`). The server must agree, which means it needs the zone.

---

## 4. Data model

### 4.1 Entities already defined by the client

These zod schemas in `src/types/models.ts` are the contract. Treat them as frozen; the DB may hold more, the API must not hold less.

**`User`** — `id`, `name`, `email`, `avatarUrl?`, `heightCm?`, `weightKg?`, `dateOfBirth?`, `phone?` (E.164), `profileCompletedAt?`, `gender?` (`male|female|other`), `goal` (`lose_weight|build_muscle|gain_strength|improve_endurance|stay_active`), `activityLevel` (`sedentary|light|moderate|active|athlete`), `units` (`metric|imperial`), `streakDays`, `weeklyGoalWorkouts`.

> `profileCompletedAt` is **server-set and load-bearing**. `RootNavigator` gates the entire app on it: null means the user is routed to onboarding forever. Set it only in `POST /me/complete-profile`, never inferred from whether fields happen to be filled.

**`Exercise`** — `id`, `name`, `muscleGroup` (10 values), `equipment` (8 values), `isTimed`, `imageUrl?`
**`WorkoutSet`** — `id`, `reps`, `weightKg`, `rpe?` (1–10), `durationSeconds?`, `completed`
**`WorkoutExercise`** — `id`, `exercise`, `sets[]`, `restSeconds`, `notes?`
**`Workout`** — `id`, `title`, `startedAt`, `completedAt?`, `exercises[]`, `totalVolumeKg`, `caloriesBurned`
**`WorkoutTemplate`** — `id`, `title`, `description`, `estimatedMinutes`, `muscleGroups[]`, `exercises[]`
**`DailyActivity`** — `date` (`YYYY-MM-DD`), `steps`, `activeMinutes`, `caloriesBurned`, `workoutsCompleted`
**`BodyMeasurement`** — `id`, `recordedAt`, `weightKg`, `bodyFatPercent?`
**`CoinTransaction`** — `id`, `title`, `source` (`steps|workout|streak|challenge|referral|purchase|refund`), `amount` (**signed** int), `createdAt`
**`ShopItem`** — `id`, `title`, `description`, `priceCoins`, `category` (`apparel|accessories|gear|lifestyle`), `emoji`, `badge?` (`bestseller|popular|new_arrival|limited`), `isDeal`, `inStock`
**`Challenge`** — `id`, `title`, `description`, `emoji`, `metric` (`steps|calories|minutes|days|workouts`), `cadence` (`daily|weekly|monthly`), `goal`, `progress`, `rewardCoins`, `rewardsBadge`, `startsAt?` (**null = currently running**, a date = upcoming)
**`Achievement`** — `id`, `value` (string), `label`, `metric`, `achievedAt?` (null = locked)
**`HydrationEntry`** — `id`, `ml`, `at`
**`LeaderboardEntry`** — `id`, `name`, `location` (`"Delhi, India"`), `rank`, `coins`, `perk`, `avatarUrl?`
**`AppNotification`** — `id`, `topic` (9 values), `title`, `message`, `createdAt`, `read`
**`AuthTokens`** — `accessToken`, `refreshToken`, `expiresAt` (epoch ms)
**`VerificationChallenge`** — `verificationId`, `phone`, `codeLength`, `expiresInSeconds`, `resendInSeconds`

### 4.2 Entities the backend must add

Not in the client yet, but required for a server-authoritative economy:

| Table | Purpose |
|---|---|
| `coin_ledger` | Append-only, the single source of balance. See 8.1 |
| `coin_balances` | Materialised `{user_id, balance, lifetime_earned, updated_at}` — a projection, never edited directly |
| `activity_samples` | Raw step/distance/energy samples as submitted, with source + attestation verdict. See 7.4 |
| `activity_daily` | Rolled-up per-user-per-local-day totals, the thing `GET /activity/*` reads |
| `health_connections` | Per user per provider: `health_connect`, `healthkit`, `manual`; grant scopes, last sync cursor |
| `device_attestations` | Play Integrity / App Attest verdicts, keyed by device |
| `devices` | Push tokens, platform, app version, last seen |
| `streak_days` | One row per user per local day: `earned` (workout) or `protected` (freeze/restore) |
| `streak_freezes` | Grants and spends, so a balance is explainable |
| `challenge_definitions` / `challenge_enrollments` | Catalogue vs. per-user progress and claims |
| `leaderboard_periods` / `leaderboard_snapshots` | Frozen final standings per period, so history is immutable |
| `orders` / `order_items` / `fulfilments` | Physical redemption — the shop ships real goods |
| `shop_inventory` | Stock counts behind `inStock` |
| `notifications` | Per-user feed rows |
| `referrals` | Inviter, invitee, qualifying event, payout state |
| `idempotency_keys` | See 3.6 |
| `audit_log` | Every coin mutation, admin action and fraud verdict |

### 4.3 Money-shaped data rules

Coins are a currency. Apply currency discipline:

- **Integers only.** No floats anywhere in the coin path.
- **Append-only ledger.** A correction is a new compensating row with `source: 'refund'`, never an `UPDATE` or `DELETE`.
- **Balance is derived, then cached.** Recompute from the ledger nightly and alert on any drift from `coin_balances`.
- **`SELECT … FOR UPDATE`** (or equivalent) on the balance row for every spend. A double-tap on Redeem must not oversell.
- The client's own comment already documents why balance is stored rather than summed: the device ledger is trimmed to **50 rows** (`MAX_LEDGER_ENTRIES`). The server keeps everything.

---

## 5. Endpoint catalogue

Grouped by domain. **[E]** = already called by the client, build to match exactly. **[N]** = new, client work required.

### 5.1 Auth and identity

| | Endpoint | Notes |
|---|---|---|
**[E]**| `POST /auth/sign-in` | Body `{ email, password }`. → `AuthResponse`. **The client's sign-in field accepts an email *or* a phone number** (`identifier` in `src/types/forms.ts`) but the API method is named `email` — accept either string in that field and resolve server-side. |
**[E]**| `POST /auth/sign-up` | Body `{ email, phone (E.164), password, dateOfBirth, gender }`. → **`VerificationChallenge`, not a session.** No tokens until the phone is proven. |
**[E]**| `POST /auth/verify-otp` | Body `{ verificationId, code }`. → `AuthResponse`. A wrong code must leave the challenge alive — the client keeps the user on the screen and retries. |
**[E]**| `POST /auth/resend-otp` | Body `{ verificationId }`. → a **fresh** `VerificationChallenge` with its own `expiresInSeconds` and `resendInSeconds`; the screen's two countdowns are driven entirely by these. |
**[E]**| `POST /auth/sign-out` | → `{ ok: boolean }`. Revoke the refresh token. Client never blocks on this. |
**[E]**| `POST /auth/refresh` | Body `{ refreshToken }` → `AuthTokens`. Must not require a valid access token. |
**[N]**| `POST /auth/social` | `{ provider: 'google'\|'apple'\|'facebook', idToken, nonce? }` → `AuthResponse`. UI exists, handlers are no-ops. Verify the token server-side against the provider; never trust a client-decoded profile. |
**[N]**| `POST /auth/forgot-password` / `POST /auth/reset-password` | No UI yet, but sign-in has no recovery path at all today. |
**[N]**| `DELETE /me` | Account deletion. **Store-mandated** on both platforms for an app with an account. Must cascade or anonymise health data. |

Password policy the client enforces — mirror it, do not exceed it: 8–72 characters, at least one letter and one digit, no symbol or case requirement. The 72 ceiling is bcrypt's; do not silently truncate.

OTP hardening (the mock accepts `123456` for everything — `MOCK_RULES` in `src/services/api/mockApi.ts`):
- 6 digits, cryptographically random, **hashed at rest**
- TTL 5 minutes, max 5 verify attempts per `verificationId`, then burn it
- Resend cooldown 30s, max 3 resends per number per hour, max 10 per day
- Per-IP and per-number rate limits — SMS is a direct cost and a known abuse target

### 5.2 Profile

| | Endpoint | Notes |
|---|---|---|
**[E]**| `GET /me` | → `User`. Called on every cold start by `authStore.hydrate()`. Keep it fast; it is on the launch critical path. |
**[E]**| `PATCH /me` | Partial `User`. → full `User`. Must **not** set `profileCompletedAt`. |
**[E]**| `POST /me/complete-profile` | `{ name, heightCm, weightKg, units }` → `User` **with `profileCompletedAt` stamped**. The only endpoint that may set it. Client validates 90–250 cm and 25–300 kg after unit conversion; re-validate server-side. |
**[N]**| `GET /me/highlights` | Replaces `profileHighlights`. → `{ level, tierTitle, memberSince (ISO), achievementCount, lifetimeSteps }`. Define the level curve server-side. |
**[N]**| `POST /me/avatar` | Multipart or pre-signed S3 PUT. `avatarUrl` exists on the model with nothing to fill it. |
**[N]**| `GET /me/export` | Data export. Pairs with `DELETE /me` for GDPR/DPDP. |

### 5.3 Activity and steps

The heart of the product. Section 7 covers ingestion and fraud in depth; these are the shapes.

| | Endpoint | Notes |
|---|---|---|
**[E]**| `GET /activity/weekly` | → `DailyActivity[]`, 7 entries, oldest→newest, **local** days. **Add `distanceKm`** to the schema (see 2.4 #3). |
**[N]**| `GET /activity/today` | → `DailyActivity` + `distanceKm`. Feeds `StepGoalCard` and `ActivityMetricsRow`; currently `todayActivity` seed. |
**[N]**| `POST /activity/ingest` | The write path. Batch of raw samples from Health Connect / HealthKit + attestation. Idempotent. See 7.4 |
**[N]**| `GET /activity/range?from=&to=&granularity=day` | History for charts beyond seven days. |
**[N]**| `GET /health/connections` / `POST /health/connections` / `DELETE /health/connections/:provider` | Which sources are linked, and consent state per source. |

### 5.4 Workouts

| | Endpoint | Notes |
|---|---|---|
**[E]**| `GET /workout-templates` | → `WorkoutTemplate[]`. Currently the `workoutTemplates` seed. |
**[E]**| `GET /workouts?cursor=` | → `Workout[]` today; **recommend wrapping in `{data, nextCursor}`** now (3.7). |
**[E]**| `POST /workouts` | Full `Workout` → saved `Workout`. **Must be idempotent on `Workout.id`** — the client generates the id locally, saves to MMKV first, and retries on failure (`workoutStore.finishWorkout`). Server recomputes `totalVolumeKg` and `caloriesBurned`; never trust the client's figures, they are coin-bearing. |
**[N]**| `GET /exercises?muscleGroup=&equipment=` | The exercise library. `ActiveWorkoutScreen` has no picker source. |
**[N]**| `PATCH /workouts/:id`, `DELETE /workouts/:id` | Editing history. Deleting a workout that paid coins must post a `refund` row, not silently rewrite the balance. |
**[N]**| `GET /measurements`, `POST /measurements` | `BodyMeasurement` is modelled and entirely unused. |

### 5.5 Hydration

The store keeps **only today** and drops it at local midnight (`src/stores/hydrationStore.ts`). Everything on the Hydration screen's stats card is the `hydrationHighlights` seed.

| | Endpoint | Notes |
|---|---|---|
**[N]**| `POST /hydration/entries` | `{ ml, at }` → `HydrationEntry`. Idempotent. |
**[N]**| `DELETE /hydration/entries/:id` | The log already supports row deletion locally. |
**[N]**| `GET /hydration/today` | → `{ date, consumedMl, goalMl, entries[] }` |
**[N]**| `GET /hydration/stats` | Replaces `hydrationHighlights`: `{ bestStreakDays, dailyAverageMl, goalHitRatePercent, reminderCount }` |
**[N]**| `GET/PUT /hydration/reminders` | The seed advertises "3 daily reminders" with no scheduler behind it. |

### 5.6 Streaks

Currently **entirely client-side** in `src/stores/streakStore.ts`, seeded with two synthetic runs. The logic there is good and worth porting verbatim to the server:

- A streak is **not broken until the day it needed is over** — `currentStreakOf` accepts today *or* yesterday as the anchor.
- `completedDays` (earned) and `protectedDays` (freeze/restore) both count, but render differently. Keep the distinction: users should see which days they actually earned.
- Restore bridges the gap from the last run to today, costs **50 coins** (`STREAK_RESTORE_COST`), and is refused beyond a **7-day** window (`RESTORE_WINDOW_DAYS`).

| | Endpoint | Notes |
|---|---|---|
**[N]**| `GET /streak` | `{ currentStreak, longestStreak: {length, start, end}, completedDays[], protectedDays[], freezesAvailable, canRestore, restoreCostCoins, restoreGap[] }` |
**[N]**| `POST /streak/freeze` | Spends a freeze on today. Refuse if none left or today already covered — **without charging**. |
**[N]**| `POST /streak/restore` | Atomic: debit 50 coins **and** write the protected days in one transaction, or neither. The client currently checks `canRestore` then spends coins in two separate steps — a race the server must close. |
**[N]**| `GET /streak/milestones` | Milestone table + which are achieved. Note the milestone check is against **longest**, not current: a user who hit 30 days in March keeps that badge in April. |

### 5.7 Coins and wallet

**This is the section that must not stay on the device.** See section 8 for the economy rules.

| | Endpoint | Notes |
|---|---|---|
**[N]**| `GET /wallet` | `{ balance, lifetimeEarned, expiresAt, expiryDaysLeft, monthSummary: {earned, spent, net} }`. "Month" is the **calendar** month, matching the client. |
**[N]**| `GET /wallet/transactions?cursor=&source=` | → `{data: CoinTransaction[], nextCursor}`. Signed amounts. The "View All" screen does not exist yet client-side. |
**[N]**| `GET /wallet/earn-rules` | Serve the rate card so rates can change without an app release. |
| | **No `POST /wallet/earn`.** | Coins are only ever minted by the server as a side effect of a verified event. There must be no client-callable credit endpoint. |

### 5.8 Challenges and achievements

| | Endpoint | Notes |
|---|---|---|
**[N]**| `GET /challenges?cadence=&date=` | → `Challenge[]`. `startsAt: null` = running, a date = upcoming. The client splits its two lists on exactly this — do not add a status field beside it. |
**[N]**| `POST /challenges/:id/join` | Explicit enrolment, if the product wants it; otherwise auto-enrol and drop this. |
**[N]**| `POST /challenges/:id/claim` | Idempotent, server-verified progress ≥ goal, posts the coin credit. Never trust client `progress`. |
**[N]**| `GET /achievements` | → `Achievement[]`. Recommend sending `{ value: number, metric, label, achievedAt }` and letting the client's `formatCompactNumber` produce `"10K"`. |

`Challenge.progress` must be **recomputed server-side** from verified activity on every read. It is the number that unlocks a coin payout.

### 5.9 Leaderboard and rewards

Country-scoped, **weekly** reset (`LeaderboardHowItWorks`: "ranked against everyone in your country").

| | Endpoint | Notes |
|---|---|---|
**[N]**| `GET /leaderboard?period=weekly&scope=country&cursor=` | → `{period: {start, end, resetsAt}, entries: LeaderboardEntry[], me: {rank, coins, percentile}, nextCursor}`. **Add an `isCurrentUser` flag or the `me` block** — the board has no way to highlight the viewer today. |
**[N]**| `GET /leaderboard/history` | Replaces `leaderboardHighlights`: `{ bestRank, bestRankAchievedOn (ISO), topTenFinishes, rewardCoinsEarned, rewardsWon }` |
**[N]**| `GET /leaderboard/reward-tiers` | Serve `REWARD_TIERS` so prizes can change seasonally. |

Ranking integrity: rank on **verified** steps only (section 7). Freeze the standings into `leaderboard_snapshots` at period close, then pay out — never pay from a live query. Tie-break deterministically (earlier achievement of the total, then user id) so two users cannot both be rank 2.

### 5.10 Shop and orders

The shop ships **physical goods**. That makes redemption an order pipeline, not a balance decrement.

| | Endpoint | Notes |
|---|---|---|
**[N]**| `GET /shop/items?category=&deals=&cursor=` | → `ShopItem[]`. `inStock` must reflect real inventory. |
**[N]**| `GET /shop/items/:id` | Detail for the bottom sheet. |
**[N]**| `POST /shop/redeem` | `{ itemId, quantity, shippingAddressId }` + `Idempotency-Key`. **One transaction:** lock balance → verify funds → decrement inventory → write `purchase` ledger row → create order. Any failure rolls all of it back. |
**[N]**| `GET /orders?cursor=`, `GET /orders/:id` | The account menu already has an "Orders" row wired to a no-op. |
**[N]**| `POST /orders/:id/cancel` | Refund posts a `refund` ledger row and restores inventory. |
**[N]**| `GET/POST /me/addresses` | **Missing entirely from the client.** You cannot ship a t-shirt without one; this needs UI as well as API. |

The client currently counts orders by filtering the ledger for `source === 'purchase'` (`ShopScreen`). That stops being correct the moment refunds or multi-item orders exist — orders need their own resource.

### 5.11 Notifications

| | Endpoint | Notes |
|---|---|---|
**[N]**| `GET /notifications?category=&cursor=` | → `AppNotification[]`, newest first. Categories are **derived from topic** server-side using the same map as `NOTIFICATION_CATEGORY`: activity = steps/workout/streak/hydration, reward = coins/challenge/reward, system = health/system. |
**[N]**| `GET /notifications/counts` | Per-category **totals** (not unread counts — the client deliberately shows totals so a filter never looks empty). |
**[N]**| `POST /notifications/:id/read`, `POST /notifications/read-all` | |
**[N]**| `POST /devices` / `DELETE /devices/:token` | FCM token registration. `@react-native-firebase/messaging` is installed and unused. |
**[N]**| `GET/PUT /me/notification-preferences` | Per-topic opt-out. Required by both stores for push. |

### 5.12 Settings, referrals, misc

| | Endpoint | Notes |
|---|---|---|
**[N]**| `GET/PUT /me/settings` | Mirror `settingsStore` so goals follow the user across devices: `dailyStepGoal` (1,000–50,000, default 10,000), `dailyWaterGoalMl` (500–8,000, default 2,500), `restTimerSeconds` (15–600, default 90), `units`, `hapticsEnabled`, `workoutRemindersEnabled`, `keepAwakeDuringWorkout`. |
**[N]**| `GET /me/referral-code`, `POST /referrals/redeem` | 300 coins "once they log a workout" — the qualifying event is a **verified** first workout, not sign-up. Cap payouts per inviter and screen for self-referral rings. |
**[N]**| `GET /config` | Remote config: earn rates, feature flags, minimum supported app version, maintenance flag. Saves an app release every time a number changes. |
**[N]**| `GET /health` (unauthenticated) | Liveness for monitoring. |
**[N]**| `GET /content/motivation` | The `MotivationCard` quote is a hardcoded string. Low priority, trivially cheap. |

---

## 6. Two schema changes needed on day one

### 6.1 `DailyActivity` needs `distanceKm`

`ActivityMetricsRow` on Home renders distance, active minutes and calories. `dailyActivitySchema` has the last two and not the first, so the screen reads the seed instead. Additive change, safe under the validation rules in 3.5:

```ts
export const dailyActivitySchema = z.object({
  date: z.string(),
  steps: z.number().int().nonnegative().default(0),
  distanceKm: z.number().nonnegative().default(0),   // add
  activeMinutes: z.number().int().nonnegative().default(0),
  caloriesBurned: z.number().nonnegative().default(0),
  workoutsCompleted: z.number().int().nonnegative().default(0),
  source: z.enum(['health_connect', 'healthkit', 'manual']).nullable().default(null), // add
  verified: z.boolean().default(false),               // add
});
```

`source` and `verified` let the UI be honest about unverified days — see 7.6.

### 6.2 `LeaderboardEntry` cannot identify the viewer

Add either a flag on the row or a `me` block on the response (5.9). Without it the board cannot highlight "you", which is the single most-looked-at row on the screen.

---

## 7. Steps: sources, ingestion and fraud

You asked specifically about this, comparing Sweatcoin and Google Fit. Here is the honest landscape and a concrete recommendation.

### 7.1 The constraint that shapes everything: there is no server-side step API

Both platform health stores are **on-device only**.

- **Health Connect** (Android) is an OS-level datastore. There is no cloud endpoint — your server cannot read a user's steps. The app reads locally and uploads.
- **HealthKit** (iOS) is the same: on-device, no server API, and Apple's terms forbid using HealthKit data for advertising or selling it on.

**Google Fit is not the answer in 2026.** Google deprecated the Google Fit developer APIs — the Android Fitness API and the Fit REST API — and directed developers to Health Connect on Android. The Fitness API stopped serving most developers during 2025, and the REST API is on a turn-down path. *Verify the current dates against Google's developer documentation before you plan around them*, but the direction is settled: **do not build on Google Fit.** Health Connect is the Android surface, and the client already has it installed and its Android permission delegate wired.

Consequence: **the client is the only thing that can read steps, so the server can never fully trust the numbers it receives.** Every architectural decision below follows from that single fact. This is exactly the problem Sweatcoin has, and it is why their verification is the interesting part of their product rather than their step counter.

### 7.2 What Sweatcoin actually does, and what to borrow

Sweatcoin converts step counts into a currency redeemable for goods — structurally the same problem as Vokve. Their publicly described approach, and the parts worth copying:

| Sweatcoin behaviour | Why | Borrow it? |
|---|---|---|
| Counts **outdoor** steps only (historically), corroborated by GPS/motion | A treadmill, a shaken phone and a dog's collar all produce steps; movement through space is much harder to fake | **Partly.** Full GPS corroboration costs battery and privacy. Use it as a *confidence signal*, not a gate — see 7.5 |
| **Daily credited cap** on the free tier | Bounds the payout of any successful attack to a known number | **Yes, unconditionally.** Cheapest, most effective control you will ship |
| Multi-sensor verification, on-device plus server-side | Single-signal checks are trivially defeated | **Yes** |
| Conversion rate well under 1:1 (roughly 1,000 steps ≈ 0.95 coins) | Keeps unit economics survivable at scale | **Recheck your rate.** See 8.3 — Vokve's advertised rate is an order of magnitude more generous |
| Retroactive clawback of fraudulent balances | Detection is always partly after the fact | **Yes.** The `refund` ledger source already exists for this |

The lesson is not a specific algorithm. It is that **the payout ceiling, not the fraud detector, is what makes the economy safe.** A detector you can tune later; a cap protects you from day one.

### 7.3 Recommended architecture

```
┌──────────────── Device ────────────────┐
│  Health Connect (Android 9+)           │   steps, distance, active calories
│  HealthKit (iOS 13+)                   │   + per-sample metadata:
│                                        │     dataOrigin / sourceRevision
│  read since last sync cursor           │     recordingMethod / wasUserEntered
│         │                              │     device model, sample interval
│         ▼                              │
│  local pre-filter + batch (15 min /    │
│  on foreground / on background task)   │
│         │                              │
│  Play Integrity (Android)              │   attestation token
│  App Attest    (iOS)                   │
└─────────┼──────────────────────────────┘
          ▼  POST /activity/ingest   (Idempotency-Key)
┌──────────────── Server ────────────────┐
│ 1. verify attestation token            │  → reject emulator / tampered app
│ 2. dedupe by (user, source, sample id) │  → idempotent replay
│ 3. provenance filter (7.4)             │  → drop manual & untrusted origins
│ 4. plausibility scoring (7.5)          │  → confidence 0–100
│ 5. write activity_samples (raw, kept)  │
│ 6. roll up into activity_daily         │  → verified vs. unverified totals
│ 7. apply caps, then mint coins (8.2)   │  → ledger row, idempotent per day
│ 8. recompute challenges + leaderboard  │
└────────────────────────────────────────┘
```

Keep raw samples. When you later find a fraud pattern you did not anticipate, replaying raw samples is the difference between a targeted clawback and a guess.

### 7.4 Provenance filtering — the highest-value, lowest-effort control

Both platforms tell you **where a sample came from and how it was recorded**. Use it. This single filter eliminates the entire class of "user typed 50,000 steps into a health app".

**Android / Health Connect** — each record carries `Metadata`:
- `dataOrigin.packageName` — which app wrote it. Maintain an **allowlist** of trusted writers (the OS-level provider, Vokve itself, major OEM fitness apps and known-good wearables). Everything else is unverified.
- `recordingMethod` — reject `MANUAL_ENTRY` outright. Accept `ACTIVELY_RECORDED` and `AUTOMATICALLY_RECORDED`; treat `UNKNOWN` as unverified.
- `device` — model and type. A step record whose device is unknown deserves suspicion.

**iOS / HealthKit** — each sample carries:
- `HKMetadataKeyWasUserEntered` — reject `true`.
- `sourceRevision.source.bundleIdentifier` — same allowlist logic. `com.apple.health` for the iPhone's own pedometer is the trusted baseline.
- `device` — a paired Apple Watch is a stronger signal than the phone alone.

Do this filtering **server-side on submitted metadata, not client-side**, so a patched client cannot skip it. The client submits metadata; the server decides.

### 7.5 Plausibility scoring

Score each daily rollup 0–100. Coins pay on verified steps only; unverified steps still show in the UI (7.6) but mint nothing.

| Check | Reject / penalise when |
|---|---|
| **Cadence ceiling** | Sustained > 3.5 steps/sec over any 60s window. Elite sprinters peak near 5/sec for seconds, not minutes |
| **Daily ceiling** | Above ~30,000 steps/day, credit is capped regardless (8.2). ~45,000+ is an outlier worth review |
| **Stride coherence** | `distance / steps` outside 0.35–1.2 m. Shaking a phone produces steps with no distance; a car ride produces distance with no steps |
| **Energy coherence** | Active calories wildly inconsistent with steps × the user's body mass |
| **Burst shape** | A day's steps arriving in a handful of identical high-count blocks. Human days are ragged |
| **Timestamp sanity** | Future timestamps, overlapping intervals, backfill older than 7 days, device clock skew > 5 min from server time |
| **Duplicate samples** | Same interval from two sources — count once, prefer the higher-trust source |
| **Impossible travel** | Samples from locations too far apart for the elapsed time (only if you collect coarse location; it is optional) |
| **Device sharing** | One device id feeding several accounts — a strong referral-farm signal |
| **Attestation** | Failed Play Integrity / App Attest, rooted or jailbroken device, emulator, or a repackaged app signature |

Start **permissive and observing**: compute scores, log them, credit almost everything, and watch the distribution for two to four weeks. Then set thresholds from your own data. Thresholds guessed before launch will either punish honest users or wave through the obvious attacks.

### 7.6 Be honest in the UI about unverified data

Because `DailyActivity` gains `verified` and `source` (6.1), the app can show a full step count while making clear which part earns coins. This is much better than silently discarding steps — a user whose real walk is not credited and is not told why files a support ticket and a one-star review.

### 7.7 Offline, sync and the day boundary

- **Local buffering.** The app must queue samples while offline and flush on reconnect. `@react-native-community/netinfo` is already installed and `useNetworkStatus` already exists.
- **Sync cursor per provider.** Store a "read up to" timestamp in `health_connections` so a reinstall does not re-upload a year of history — and so that re-uploading it is harmless anyway, because ingest is idempotent.
- **Background sync.** Android has `READ_HEALTH_DATA_IN_BACKGROUND` in the manifest already. iOS needs `HKObserverQuery` plus background delivery. Without these, steps only sync when the app is opened, and the leaderboard is wrong for anyone who does not open it.
- **Local midnight is the boundary.** Use `X-Vokve-Timezone` (3.8). A user who flies from Delhi to London must not lose or gain a day; recommendation is to pin each day to the zone the device reported *at the time of the sample*, and never retroactively re-bucket a day that has already paid out.

### 7.8 Rollout for steps

1. **Android first.** Health Connect is installed, permissions are declared, and the permission delegate is wired in `MainActivity.kt`. Only JS integration and the ingest endpoint are missing.
2. **iOS second** — needs the HealthKit entitlement, `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription` in `Info.plist`, and an App Store review note explaining the health data use.
3. **Manual entry never mints coins.** Offer it for completeness, mark it `source: 'manual'`, `verified: false`.
4. **Wearables later.** A paired watch is your highest-trust source; treat it as a confidence bonus, not a separate integration, since both platform stores already surface watch data.

---

## 8. The coin economy, server-side

### 8.1 Ledger design

Append-only. Every row explains itself:

```
coin_ledger
  id              uuid pk
  user_id         uuid
  amount          integer         -- signed: + earned, − spent
  source          enum            -- steps|workout|streak|challenge|referral|purchase|refund
  title           text            -- user-facing, e.g. "6,245 steps walked"
  reference_type  text            -- workout|challenge|order|streak_day|activity_day|referral
  reference_id    text            -- the thing that caused it
  idempotency_key text unique     -- nullable for server-initiated rows
  created_at      timestamptz
  UNIQUE (user_id, source, reference_type, reference_id)   -- the anti-double-pay constraint
```

That unique constraint is the real protection. It makes "pay the 10K challenge twice" a database error rather than a support ticket.

### 8.2 Earn rules (server-authoritative)

From `EarnCoinsCard`, with the caps and mechanics the client has no way to express:

| Event | Rate | Server mechanics |
|---|---|---|
| Steps | **10 coins / 1,000 verified steps** | Per local day, maintain a credited high-water mark: `owed = floor(verified_steps / 1000) * 10 − already_credited_today`. Credit only if `owed > 0`. Idempotent by `(user, 'steps', 'activity_day', date)`. **Cap at 30,000 steps/day = 300 coins.** |
| Workout | **100 coins** | Once per workout id. Require a plausible minimum — duration, and at least one completed set — or "finish a workout" becomes a tap for 100 coins. **Cap 2/day.** |
| Streak | **175 per 7 consecutive days** — *see 2.4 #1, this conflicts with the 50-coin 7-day milestone* | Idempotent by `(user, 'streak', 'streak_day', the 7th day)`. Resolve the conflict before launch |
| Referral | **300 coins** | Paid when the invitee's **first verified workout** lands, not at sign-up. Cap per inviter per month; screen for device-sharing and self-referral |
| Challenge | Per `rewardCoins` | Server-verified progress ≥ goal; one claim per enrolment |
| Leaderboard | 5,000 / 3,000 / 1,000 | From the frozen snapshot at period close, never a live query |

**Global cap:** set a per-user daily ceiling across all sources (600–800 coins is a reasonable starting point given the above). It bounds the damage from any bug or exploit you have not thought of, including the ones in this document.

### 8.3 Sanity-check the rate before launch

10 coins per 1,000 steps means a consistent 10,000-step-a-day user earns **100 coins/day, ~3,000/month**. The shop's mid-tier items sit around 250–450 coins. That is roughly **6–12 physical items per month, per active user**, before workouts, streaks, challenges, referrals or leaderboard prizes are counted.

For comparison, Sweatcoin's rate is around **0.95 coins per 1,000 steps** — roughly a tenth of Vokve's, for a product doing the same thing.

This is not a backend decision, but the backend is where it becomes an invoice. Model the cost per active user per month before the economy goes live, and put the rates behind `GET /config` (5.12) so they can be tuned without an app release. That single endpoint is the cheapest insurance in this document.

### 8.4 Expiry

The client implements a **90-day idle window** that resets on every credit (`COIN_EXPIRY_WINDOW_DAYS`), deliberately chosen over per-coin expiry because the rule a user can act on is "stay active and nothing expires".

Server-side: a nightly job finds users whose newest credit is ≥ 90 days old, posts a single negative `refund` row zeroing the balance with title "Coins expired after 90 days of inactivity", and notifies. **Warn at 14 and 3 days** — silently voiding a balance is the fastest route to a chargeback-style complaint and an app-store report.

### 8.5 Spending is a transaction

Every debit — a redemption, a streak restore — is one atomic unit:

```
BEGIN
  SELECT balance FROM coin_balances WHERE user_id = ? FOR UPDATE
  IF balance < price THEN ROLLBACK, 422 INSUFFICIENT_COINS
  decrement inventory (and check it)
  INSERT coin_ledger (negative amount)
  UPDATE coin_balances
  INSERT order
COMMIT
```

The client checks the balance twice already (the sheet, then the store) and it is still not enough — both checks run on a possibly stale render. The `FOR UPDATE` is what actually prevents overspend.

---

## 9. Scheduled jobs

| Job | Cadence | Purpose |
|---|---|---|
| Daily activity rollup | Hourly + at each local midnight | Recompute `activity_daily`, mint step coins |
| Streak evaluation | At each local midnight | Close yesterday: earned, protected, or broken |
| Challenge progress | Every 15 min | Recompute progress; mark completions claimable |
| Challenge rollover | Daily / weekly / monthly | Expire finished, open upcoming |
| Leaderboard recompute | Every 15 min | Live standings |
| Leaderboard close + payout | Weekly | Freeze snapshot, pay tiers, notify winners |
| Coin expiry warnings | Daily | 14-day and 3-day notices |
| Coin expiry sweep | Daily | Zero balances past 90 idle days |
| Balance reconciliation | Nightly | Re-sum the ledger, alert on drift from `coin_balances` |
| Fraud scoring sweep | Nightly | Re-score recent activity; flag accounts, queue clawbacks |
| Hydration + workout reminders | Per user schedule | FCM push |
| Streak-at-risk push | Evening, local | "Your 7-day streak ends at midnight" — the highest-value retention push this product has |
| Inventory alerts | Daily | Low stock on shop items |

Every job must be idempotent and safe to re-run; they will be re-run.

---

## 10. Security and compliance

### 10.1 Health data is sensitive data

Steps, weight, height, gender and date of birth together constitute health data under GDPR Article 9 and comparable regimes (India's DPDP Act, HIPAA where a covered entity is involved). Consequences:

- **Explicit, granular, revocable consent** per data source. `DELETE /health/connections/:provider` must actually stop ingestion and be honoured immediately.
- **Encrypt at rest**, and keep health tables in their own schema with separate access controls.
- **Data minimisation.** Do not collect location unless you decide to use it for verification (7.5), and if you do, keep it coarse and short-lived.
- **Apple's HealthKit terms** forbid using HealthKit data for advertising or similar use, and forbid disclosing it to third parties without consent. Read them before any analytics pipeline touches step data.
- **Google Health Connect** requires a declared, reviewed data-use policy and the permission rationale screen — which the app already has in `PermissionRationaleActivity.kt`.
- **Right to erasure and export**: `DELETE /me` and `GET /me/export` are compliance requirements, not features.

### 10.2 API hardening checklist

- TLS 1.2+ only; consider certificate pinning for the auth and ingest paths
- Rate limits: per IP, per user, per endpoint. Tightest on `/auth/*` (OTP costs money) and `/activity/ingest` (mints coins)
- Argon2id or bcrypt for passwords; never log credentials, OTPs or tokens
- Authorisation on every resource read — a `GET /orders/:id` that does not check ownership is the classic IDOR
- Validate and bound every numeric input server-side; the client's clamps (step goal 1,000–50,000, water 500–8,000 ml) are UX, not security
- Attestation on ingest (7.5), plus a minimum-supported-app-version gate via `GET /config` so you can cut off a known-vulnerable client build
- Audit log for every coin mutation, admin action and fraud verdict
- Alert on: balance drift, ingest volume spikes, one device across many accounts, referral clusters, redemption rate anomalies

### 10.3 Flags to remove before production

`src/constants/config.ts` ships with two development switches:

```ts
bypassAuthInDev: true,   // skips the sign-in gate entirely
useMockApi: true,        // serves every call from mockApi.ts
```

Both are guarded by `__DEV__` at their call sites (`shouldBypassAuth()` in `RootNavigator`, `shouldUseMockApi()` in `endpoints.ts`), which compiles to `false` in release. **That guard is correct and should stay.** But add a release-build CI assertion that both flags are `false` in source as well — defence in depth costs one test.

---

## 11. Gap analysis by screen

| Screen | Data it shows | Source today | Endpoints needed |
|---|---|---|---|
| Sign in / up / OTP | Session | **mockApi** (OTP `123456`) | 5.1 — exists, needs implementing |
| Complete profile | Height, weight, units | mockApi | `POST /me/complete-profile` |
| **Home** | Today's steps, distance, active min, calories; weekly chart; streak; hydration | `todayActivity`, `weeklySteps` seeds | `GET /activity/today`, `/activity/weekly` (+`distanceKm`), `GET /streak`, `GET /hydration/today` |
| **Wallet** | Balance, lifetime, month summary, expiry, ledger | **client-only MMKV store** | `GET /wallet`, `/wallet/transactions`, `/wallet/earn-rules` |
| **Shop** | Catalogue, categories, deals, redemption, order count | `shopItems` seed + client store | `GET /shop/items`, `POST /shop/redeem`, `GET /orders`, addresses |
| **Account** | Level, tier, member since, achievements, lifetime steps | `profileHighlights` seed | `GET /me/highlights`, `GET /me/settings` |
| **Challenges** | Active + upcoming challenges, achievements | `seedChallenges`, `seedAchievements` | `GET /challenges`, `POST /challenges/:id/claim`, `GET /achievements` |
| **Streak** | Calendar, current, longest, freezes, restore | client-only store, seeded | `GET /streak`, `POST /streak/freeze`, `POST /streak/restore` |
| **Leaderboard / Rewards** | Standings, own history, tiers | `seedLeaderboard`, `leaderboardHighlights` | `GET /leaderboard`, `/leaderboard/history`, `/leaderboard/reward-tiers` |
| **Hydration** | Today's log, stats, reminders | store (today) + `hydrationHighlights` | `POST/DELETE /hydration/entries`, `GET /hydration/today`, `/hydration/stats` |
| **Notifications** | Feed, filters, counts, read state | `seedNotifications` | `GET /notifications`, `/counts`, read endpoints, `POST /devices` |
| **Workouts** | Templates | `workoutTemplates` seed | `GET /workout-templates` |
| **Active workout** | Exercise picker | **no source at all** | `GET /exercises` |
| **Progress** | Workout history | store (local only) | `GET /workouts` |

Dead-ends already visible in the UI as no-op handlers, each needing an endpoint *and* a screen: coin history, orders, coin-expiry explainer, edit profile, privacy settings, notification preferences, security settings, premium upgrade, health data connections, help, about, shipping addresses.

---

## 12. Suggested delivery phases

**Phase 1 — Make the existing contracts real (2–3 weeks)**
Auth (incl. real OTP + SMS provider), `/me`, `/me/complete-profile`, refresh/rotation, `/workout-templates`, `/workouts`, `/activity/weekly`. Then set `useMockApi: false` and the app runs on a real backend with no client changes — that is what the contract split in `contracts.ts` was built for. Add `GET /config` and `POST /devices` here; both are cheap and unblock later work.

**Phase 2 — Steps, honestly (3–4 weeks)**
Health Connect JS integration on Android, `POST /activity/ingest`, provenance filtering, attestation, `/activity/today`, `/activity/range`, daily rollup job, `verified` surfaced in the UI. **No coin minting yet** — observe the data first.

**Phase 3 — Move the economy to the server (3–4 weeks)**
`coin_ledger`, `/wallet/*`, migrate the client store to a read-through cache, turn on step/workout minting with caps, expiry job, reconciliation, audit log. This is the phase that closes the vulnerability in section 1.

**Phase 4 — Engagement (3–4 weeks)**
Server streaks (freeze/restore atomic), challenges engine, achievements, notification feed + push, hydration history and reminders.

**Phase 5 — Rewards and fulfilment (3–4 weeks)**
Leaderboard periods and snapshots, weekly payout, shop inventory, redemption transaction, orders, addresses, shipping integration, support tooling.

**Phase 6 — iOS parity and hardening**
HealthKit entitlement and ingestion, background delivery, fraud thresholds tuned from real data, clawback tooling, load testing.

Phases 2 and 3 are deliberately separate. Shipping step minting before you have watched a few weeks of real step distributions means setting fraud thresholds by guesswork, on a system that pays out physical goods.

---

## 13. Open questions for product

1. **The 7-day streak conflict** (2.4 #1) — is 175 coins a repeating weekly bonus, or is 50 the one-off 7-day milestone? The answer changes the payout curve substantially.
2. **Coin rate** (8.3) — has anyone modelled cost per active user per month at 10 coins/1,000 steps?
3. **Leaderboard scope** — "country" is stated on screen. Which country: signup, device locale, or IP at period close? What about a user who moves?
4. **Shipping** — who fulfils physical prizes, in which countries, and who pays duties? This determines whether addresses need validation and what the order state machine looks like.
5. **Premium tier** — `PremiumUpsellCard` exists with a no-op. Subscription, or coin multiplier? Either way it needs IAP and a receipt-validation endpoint that is not in this document.
6. **Manual step entry** — offer it at all, given it can never mint coins?
7. **Referral qualification** — "once they log a workout" is generous and farmable. Add a minimum account age or a verified-steps threshold?
8. **Challenge enrolment** — auto-enrol everyone, or explicit join? Affects whether `progress` is per-user rows or computed on read.
9. **Data retention** — how long are raw `activity_samples` kept? Fraud investigation wants years; data minimisation wants months.

---

## 14. Appendix — reference request/response pairs

**Sign up → OTP**
```http
POST /v1/auth/sign-up
{ "email": "asha@example.com", "phone": "+919876543210",
  "password": "walk1000steps", "dateOfBirth": "1994-03-21", "gender": "female" }

200
{ "verificationId": "vrf_01HZX...", "phone": "+919876543210",
  "codeLength": 6, "expiresInSeconds": 300, "resendInSeconds": 30 }
```

**Verify → session**
```http
POST /v1/auth/verify-otp
{ "verificationId": "vrf_01HZX...", "code": "418205" }

200
{ "user": { "id": "usr_01HZX...", "name": "", "email": "asha@example.com",
            "avatarUrl": null, "heightCm": null, "weightKg": null,
            "dateOfBirth": "1994-03-21", "phone": "+919876543210",
            "profileCompletedAt": null, "gender": "female",
            "goal": "stay_active", "activityLevel": "moderate", "units": "metric",
            "streakDays": 0, "weeklyGoalWorkouts": 4 },
  "tokens": { "accessToken": "eyJ...", "refreshToken": "rt_...",
              "expiresAt": 1789200000000 } }
```

**Activity ingest**
```http
POST /v1/activity/ingest
Idempotency-Key: 7f3c1e2a-...
X-Vokve-Timezone: Asia/Kolkata
{
  "attestation": { "platform": "android", "token": "..." },
  "samples": [
    { "sampleId": "hc_9f21a", "type": "steps", "value": 842,
      "startedAt": "2026-09-13T07:12:00+05:30",
      "endedAt":   "2026-09-13T07:21:00+05:30",
      "origin": "com.google.android.apps.fitness",
      "recordingMethod": "automatically_recorded",
      "device": { "manufacturer": "Google", "model": "Pixel 8" } }
  ]
}

200
{ "accepted": 1, "rejected": 0,
  "day": { "date": "2026-09-13", "steps": 6245, "verifiedSteps": 6245,
           "distanceKm": 4.2, "activeMinutes": 48, "caloriesBurned": 358,
           "workoutsCompleted": 0, "source": "health_connect", "verified": true },
  "coinsCredited": 10,
  "rejections": [] }
```

**Wallet**
```http
GET /v1/wallet

200
{ "balance": 1240, "lifetimeEarned": 2140,
  "expiresAt": "2026-12-12T00:00:00Z", "expiryDaysLeft": 90,
  "monthSummary": { "earned": 935, "spent": 700, "net": 235 } }
```

**Insufficient coins**
```http
POST /v1/shop/redeem
Idempotency-Key: c41e...
{ "itemId": "band", "quantity": 1, "shippingAddressId": "adr_01HZ..." }

422
{ "error": { "code": "INSUFFICIENT_COINS",
             "message": "You need 210 more coins for this reward.",
             "details": { "required": 450, "balance": 240 } } }
```

---

*Generated from a read-through of the client at `2e4170e`. Every "current state" claim above is traceable to a file named in the text; re-audit against the code before relying on this document after further frontend work.*
