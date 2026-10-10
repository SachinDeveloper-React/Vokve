# VOKVE — Backend Specification

**Status:** v2.1 · derived from the React Native client at commit `fdbc4b0` · **Datastore: MongoDB**
**Audience:** Backend engineers building the Vokve API from scratch
**Companion docs:** [PRD](backend/PRD.md) · [Architecture](backend/ARCHITECTURE.md) · [Rules](backend/RULES.md) · [Phases](backend/PHASES.md) · [Memory](backend/MEMORY.md)
**Client stack:** React Native 0.87.1 · React 19.2.3 · TypeScript · zod · zustand (MMKV persist) · axios · React Navigation 7

---

## 0. Table of contents

1. What this document is
2. Current state audit
3. Transport contract
4. Data model
5. Screen-by-screen specification (all 30 screens)
6. Endpoint catalogue
7. Steps: sources, ingestion and fraud
8. The coin economy, server-side
9. Scheduled jobs
10. Security and compliance
11. Delivery order (summary — see PHASES.md)
12. Open questions for product
13. Devices, versions and email verification
14. Advanced features
15. Appendix — reference request/response pairs

---

## 1. What this document is

The Vokve mobile client is **fully built and navigable — 30 screens — with no backend behind it**. Every screen renders, but almost everything it renders comes from `src/constants/seedData.ts` (1,190 lines) or from thirteen client-only zustand stores persisted to MMKV.

This document reverse-engineers the API the client already expects, specifies every endpoint it still needs, and defines the server-side rules for the parts of the product that **cannot safely stay on the device** — above all the coin economy and step counting.

It is written to be implementable without reading the app, but every claim is anchored to a file so you can check it.

### The three facts that shape the whole backend

1. **The client never mints coins.** No screen calls `coinsStore.earn()`. The only coin movements the client makes are *debits* — a shop redemption and a streak restore. The balance the wallet shows is the seeded ledger summed. This means **earning is 100% a server concern from day one**, and the client store becomes a read-through cache with no migration of "client-earned" history to reconcile.

2. **The client never writes streak days either.** `streakStore.completeToday()` has no caller. Finishing a workout does not mark the day. The server derives streak days from verified workouts and steps; the client only reads.

3. **Steps can only be read on-device.** Health Connect and HealthKit have no server API. The client uploads; the server verifies. Every fraud control in section 7 follows from this.

The balance the client holds today is in **plain-text MMKV** (per the comment in `src/services/secureStorage.ts`). Coins buy physical goods. Until section 8 is built, anyone rooted can spend coins they were never issued — but because nothing is minted client-side, moving to a server ledger is a replacement, not a migration.

---

## 2. Current state audit

### 2.1 What the client already calls

Four API groups exist, declared as interfaces in `src/services/api/contracts.ts` and implemented twice — against HTTP in `endpoints.ts`, and in-memory in `mockApi.ts`. Both satisfy the same TypeScript interface.

| Group | Endpoints | Returns |
|---|---|---|
| `AuthApi` | `POST /auth/sign-in`, `/auth/sign-up`, `/auth/verify-otp`, `/auth/resend-otp`, `/auth/sign-out` | `AuthResponse`, `VerificationChallenge` |
| `UserApi` | `GET /me`, `PATCH /me`, `POST /me/complete-profile` | `User` |
| `WorkoutApi` | `GET /workout-templates`, `GET /workouts?cursor=`, `POST /workouts` | `WorkoutTemplate[]`, `Workout[]`, `Workout` |
| `ActivityApi` | `GET /activity/weekly` | `DailyActivity[]` |

Plus `POST /auth/refresh` (`{ refreshToken }` → `AuthTokens`), called from `client.ts` with a bare axios instance so a failed refresh cannot recurse through the interceptors.

**Everything else — 12 further domains — has no endpoint.**

### 2.2 What is faked, and where

Every export of `seedData.ts` stood in for a backend feature. The **Now** column is where each one stands (D-45: the app keeps seed data only for the mock API and tests — a screen never shows it):

| Seed export | Consumed by | Stands in for | Now |
|---|---|---|---|
| `workoutTemplates` | Workouts | Template/exercise catalogue | **Gone** — `GET /workout-templates` (the screen is still not routed); mock only |
| `weeklySteps`, `todayActivity`, `todayHourlySteps`, `monthlyStepsByWeek`, `yearlyStepsByMonth` | Home, Analytics, Nutrition | Step/activity history at four granularities | **Gone** — `/activity/*` (D-41) |
| `seedStreak` | Streak store | Training-day history | **Gone** — `GET /streak` (D-44); mock only |
| `seedCoinTransactions` | Wallet, Shop, every coin badge | The coin ledger | **Gone** — `GET /wallet` (D-45); mock only |
| `shopItems` | Shop | Reward catalogue | **Gone** — `GET /shop/items` (D-45); mock and tests only |
| `seedNotifications` | Notifications | Notification feed | **Gone** — `GET /notifications` (D-45); mock only |
| `seedChallenges`, `seedAchievements` | Challenges | Challenge engine | **Gone** — `GET /challenges`, `GET /achievements` (D-46); mock only |
| `seedLeaderboard`, `leaderboardHighlights` | Leaderboard | Rankings and prize history | **Gone** — `GET /leaderboard*` (D-47); mock only |
| `hydrationHighlights`, `hydrationTip` | Hydration | Water history beyond today | **Gone** — `/hydration/*`, `/content/tips/*` (D-48); mock only |
| `seedVitals`, `healthHighlights`, `healthTip` | Health Checkup, Heart Rate, Blood Pressure | Vitals history and health score | **Gone** — `/vitals*`, `/health/score`, `/content/tips/*` (D-50); mock only |
| `seedFoodEntries`, `foodLibrary`, `quickAddFoodIds`, `dietPlanRotation`, `nutritionTip` | Nutrition, Add Meal, Diet Plan, Nutrition History | Food diary, food database, meal plans | **Gone** — `/nutrition/*`, `/foods*`, `/diet-plan*` (D-49); mock only |
| `referralCode`, `REFERRAL_REWARD_COINS`, `seedReferrals` | Referral | Referral programme | **Gone** — `GET /referrals/me`; mock only |

Thirteen zustand stores persist to MMKV. Each one is a client-side cache of state the server must own:

| Store | Key | Owns today | Should own after |
|---|---|---|---|
| `authStore` | — (Keychain) | Session, pending OTP | Same — already correct |
| `settingsStore` | `vokve.settings` | Units, step goal, water goal, rest timer, haptics, reminders, keep-awake | Server-synced preferences |
| `coinsStore` | `vokve.coins` | Balance, lifetime, 50-row ledger | **Cache only** |
| `streakStore` | `vokve.streak` | Completed/protected days, freezes | **Cache only** |
| `workoutStore` | `vokve.workouts` | Active session, history | Active session stays local; history is a cache |
| `hydrationStore` | `vokve.hydration` | Today's log | Cache + offline queue |
| `notificationsStore` | `vokve.notifications` | Feed + read state | Cache |
| `notificationSettingsStore` | `vokve.notificationSettings` | 8 category switches, quiet hours, SMS/email | Server-synced consent |
| `nutritionStore` | `vokve.nutrition` | Diary by date, goals, preferences | Cache + offline queue |
| `dietPlanStore` | `vokve.dietPlan` | Per-date plan extras | Cache |
| `vitalsStore` | `vokve.vitals` | 60 most recent readings | Cache + offline queue |
| `remindersStore` | `vokve.reminders` | Hydration reminder schedule | Server-synced; server sends push |

### 2.3 Native capability provisioned but not wired

| Capability | Provisioned | Wired in JS |
|---|---|---|
| Health Connect (Android) | Yes — `react-native-health-connect@4.1.3`, permission delegate in `MainActivity.kt`, `PermissionRationaleActivity.kt`, `READ_STEPS` / `WRITE_STEPS` / `READ_HEALTH_DATA_IN_BACKGROUND` in the manifest | **No** |
| HealthKit (iOS) | **No** — no usage strings in `Info.plist`, no entitlement | No |
| Firebase (auth, messaging, crashlytics, perf) | All four packages installed, `firebase.json` present | **No** — zero `firebase` imports under `src/` |
| Google / Apple / Facebook sign-in | `react-native-nitro-google-signin`, `react-native-fbsdk-next` installed; `SocialAuthRow` renders all three | **No** — handlers show "not connected yet" |
| OS share sheet + clipboard | Wired in `ReferralScreen` | Yes |
| Device info | `react-native-device-info@15.0.2` installed — model, OS, vendor id, `isEmulator()`, app version/build | **No** — zero imports; no device id exists anywhere in the client |

### 2.4 Contradictions the backend must resolve

Each needs a product decision before the ledger is authoritative. Tracked in [MEMORY.md](backend/MEMORY.md).

| # | Contradiction | Where |
|---|---|---|
| C1 | **7-day streak pays 175 or 50.** Rate card says 175 "every 7 days"; milestone table says 50 at day 7. Seeded ledger sides with 175. | `EarnCoinsCard.tsx` vs `StreakBenefitsCard.tsx` |
| C2 | **Referral pays 300 or 20.** Rate card says 300 "once they log a workout"; referral screen says 20 to *each side* "after verification"; seeded ledger row is +300. | `EarnCoinsCard.tsx` vs `seedData.REFERRAL_REWARD_COINS` / `HowReferralWorksCard.tsx` |
| C3 | **10K steps challenge pays 200 or 500.** | `seedChallenges` vs `seedCoinTransactions` |
| C4 | **`GET /activity/weekly` cannot feed Home.** `DailyActivity` has no `distanceKm`; `ActivityMetricsRow` needs it. | `models.ts` vs `HomeScreen.tsx` |
| C5 | **Leaderboard score is composite, not steps.** "Steps, workouts and completed challenges all count towards your score" — but no formula exists anywhere, and `LeaderboardEntry.coins` is the only number shown. | `LeaderboardHowItWorks.tsx` |
| C6 | **Streak restore is debited as `source: 'purchase'`.** It is not a shop purchase; the wallet's order count filters on `'purchase'` and would count it as an order. | `StreakScreen.tsx` vs `ShopScreen.tsx` |
| C7 | **`User.streakDays` duplicates the client streak derivation.** Model comment already concedes it. Server wins. | `models.ts` vs `streakStore.ts` |
| C8 | **Pre-formatted strings where data belongs.** `memberSince: "May 2025"`, `bestRankAchievedOn: "12 May 2025"`, `Achievement.value: "10K"`. Send ISO dates and numbers. | `seedData.ts` |
| C9 | **BMI is entered manually** as a vital, but height and weight are both on the profile. BMI should be derived. | `AddReadingSheet.tsx` |
| C10 | **Weight lives in three places:** `User.weightKg`, `BodyMeasurement.weightKg`, and `VitalReading{kind:'weight'}`. One write path is needed. | `models.ts` |
| C11 | **Health score has no formula.** Seeded as `82 / 100`. The ⓘ button is wired and will need something to say. | `healthHighlights` |
| C12 | **`Workout.startedAt` doc comment says nullable; schema is not.** Treat as required. | `models.ts` |

---

## 3. Transport contract

Not proposals — this is what `src/services/api/client.ts` does today. The server fits it.

### 3.1 Base URL and versioning

```
dev / staging  https://api.staging.vokve.app/v1
production     https://api.vokve.app/v1
```

Version in the path. The client validates every response against zod and **rejects anything that does not match** — an added field is safe; a renamed, removed or retyped one is a client-side hard failure and needs `/v2`.

### 3.2 Authentication

Bearer access token on every request. `AuthTokens = { accessToken, refreshToken, expiresAt }`, `expiresAt` in **epoch milliseconds**. Tokens live in Keychain/Keystore, never MMKV.

Refresh flow, exactly as implemented:
1. Any **401** triggers one `POST /auth/refresh`.
2. Concurrent 401s share one in-flight refresh — the client never fires two. **Rotate refresh tokens freely.**
3. On success the original request replays once with the new token. A second 401 is final.
4. On failure: Keychain cleared, session → `signed_out`.

Lifetimes: access **15 min**, refresh **60 days**, rotated on use, 30 s grace for in-flight replays.

### 3.3 Errors

`errors.ts` maps status → `ApiErrorKind`:

| Status | `kind` | Retried |
|---|---|---|
| 401 | `unauthorized` | no — triggers refresh |
| 403 | `forbidden` | no |
| 404 | `not_found` | no |
| 422 | `validation` | no |
| ≥500 | `server` | no |
| transport | `network` | **yes** |
| timeout | `timeout` | **yes** |

Body:
```json
{ "error": { "code": "OTP_INVALID", "message": "That code is not right. Check it and try again.",
             "details": { "attemptsRemaining": 2 } } }
```
`message` is rendered verbatim to the user. `code` is stable and machine-readable. Use **422** with `details` keyed by field for form errors.

### 3.4 Timeouts and retries

`requestTimeoutMs 15000` · `maxRetries 2` · backoff `400ms, 800ms`. Only `network`/`timeout` retry. **Every mutating endpoint may therefore be called three times for one intent** → 3.6.

### 3.5 Validation is strict

- Send `null` for absent nullable fields; never omit the key.
- Timestamps: ISO-8601 with zone. Calendar days: `YYYY-MM-DD`.
- Enums are closed. Adding a member to `CoinSource`, `NotificationTopic`, `ChallengeMetric`, `ShopBadge`, `ShopCategory`, `VitalKind`, `MealSlot`, `DietType`, `MealPlan`, `NutritionGoal`, `ReminderSlot` or `ReferralStatus` **breaks every installed client**. New members ship behind a client release.

### 3.6 Idempotency

`Idempotency-Key: <uuid v4>` on every write that moves coins, creates an order, or logs an entry. Store key + response 24 h; replay on repeat. Required on: workout save, activity ingest, checkout, pay, cancel, challenge claim, freeze, restore, hydration/food/vital entries.

**Only an answer that did something is replayed.** A request the server refused (4xx) changed nothing, so its key is freed rather than stored: the app keeps one key for the whole of a checkout attempt, and a checkout refused for want of a step-up code is retried under that same key with the code added (§O8). Storing the refusal would hand it straight back — the app would ask for another code, and the member would loop through the OTP screen with an order that could never be placed. A second request arriving while the first is still running still gets `409 IN_PROGRESS`.

### 3.7 Pagination

```json
{ "data": [ ... ], "nextCursor": "eyJ..." | null }
```
`GET /workouts` currently expects a bare array. **Wrap it now** while no production client exists.

### 3.8 Request headers the client should add

```
X-Vokve-Device-Id:   <server device id from POST /devices/register>
X-Vokve-Platform:    ios | android
X-Vokve-App-Version: 1.0.0            // config.appVersion / DeviceInfo.getVersion()
X-Vokve-Build:       42               // DeviceInfo.getBuildNumber()
X-Vokve-OS-Version:  17.5             // DeviceInfo.getSystemVersion()
X-Vokve-Timezone:    Asia/Kolkata     // IANA
X-Vokve-Locale:      en-IN
```
A request without `X-Vokve-Device-Id` on an authenticated route is `428 DEVICE_NOT_REGISTERED`; a blocked version is `426 UPGRADE_REQUIRED`. Full device profile is sent once via `POST /devices/register` (§13); the headers keep every later request attributable.

Timezone is load-bearing: streaks, daily challenges, hydration/nutrition day rollover and step-day boundaries are all **local-midnight** concepts, computed client-side with `todayIso()` in local time. The server must agree.

---

## 4. Data model

### 4.1 Entities the client already defines (`src/types/models.ts`)

Frozen contract. The DB may hold more; the API may not return less.

**Identity**
- `User` — `id, name, email, avatarUrl?, heightCm?, weightKg?, dateOfBirth?, phone? (E.164), profileCompletedAt?, gender? (male|female|other), goal (lose_weight|build_muscle|gain_strength|improve_endurance|stay_active), activityLevel (sedentary|light|moderate|active|athlete), units (metric|imperial), streakDays, weeklyGoalWorkouts`
  > `profileCompletedAt` is **server-set and load-bearing**: `RootNavigator` routes to onboarding forever while it is null. Only `POST /me/complete-profile` sets it.
- `AuthTokens` — `accessToken, refreshToken, expiresAt (epoch ms)`
- `VerificationChallenge` — `verificationId, phone, codeLength, expiresInSeconds, resendInSeconds`

**Training**
- `Exercise` — `id, name, muscleGroup (10), equipment (8), isTimed, imageUrl?`
- `WorkoutSet` — `id, reps, weightKg, rpe? (1–10), durationSeconds?, completed`
- `WorkoutExercise` — `id, exercise, sets[], restSeconds, notes?`
- `Workout` — `id, title, startedAt, completedAt?, exercises[], totalVolumeKg, caloriesBurned`
- `WorkoutTemplate` — `id, title, description, estimatedMinutes, muscleGroups[], exercises[]`
- `BodyMeasurement` — `id, recordedAt, weightKg, bodyFatPercent?`

**Activity**
- `DailyActivity` — `date, steps, activeMinutes, caloriesBurned, workoutsCompleted` (**needs `distanceKm`, `source`, `verified`** — 4.3)

**Economy**
- `CoinTransaction` — `id, title, source (steps|workout|streak|challenge|referral|purchase|refund), amount (signed int), createdAt`
- `ShopItem` — `id, title, description, price (paise), mrp (paise|null), currency, coinsMax (server-computed: the share cap on this item), category (clothing|gym|sports|accessories), subcategory, tags[], sizes[], rating { average, count }, emoji, badge?, isDeal, featured, inStock`. `ShopCategorySummary` — `category, count, inStock, subcategories[{ name, count }]`. `ShopConfig` — `currency, coinValuePaise, coinShareMax, shippingFeePaise, freeShippingAbovePaise, maxQuantityPerLine, paymentProvider, paymentKeyId, stepUpThreshold`. `Cart` — `lines[{ item, quantity, size, addedAt }], count, quote`. `Quote` — `lines[], mrpTotal, discount, subtotal, shipping, total, coinValuePaise, coinsMax, coinsApplied, coinsValue, payable, needsStepUp`. `Review` — `id, itemId, rating, title, body, authorName, verified, mine, createdAt, updatedAt`. `Order` — `id, status, items[{ itemId, title, emoji, quantity, size, price, mrp }], currency, subtotal, discount, shipping, total, coinsUsed, coinsValue, payable, payment { provider, status, amount, currency, providerOrderId, paidAt, expiresAt }, address, placedAt, updatedAt, trackingRef, cancellable`
- `Challenge` — `id, title, description, emoji, metric (steps|calories|minutes|days|workouts), cadence (daily|weekly|monthly), goal, progress, rewardCoins, rewardsBadge, startsAt? (null = running)`
- `Achievement` — `id, value (string), label, metric, achievedAt?`
- `LeaderboardEntry` — `id, name, location, rank, coins, perk, avatarUrl?`
- `Referral` — `id, name, joinedAt, status (pending|rewarded), rewardCoins`

**Wellness**
- `HydrationEntry` — `id, ml, at`
- `HydrationReminder` — `id, time (HH:mm), slot (morning|afternoon|evening|custom), enabled`
- `VitalReading` — `id, kind (heart_rate|blood_pressure|bmi|weight), value, secondary? (diastolic), recordedAt`
- `FoodEntry` — `id, slot (breakfast|lunch|snack|dinner), name, portion, calories, proteinG, carbsG, fatsG, fiberG, loggedAt`
- `FoodItem` — `id, name, portion, emoji, calories, proteinG, carbsG, fatsG, fiberG`
- `PlannedMeal` — `id, slot, time, calories, proteinG, carbsG, fatsG, items[{name, quantity}]`
- Enums: `DietType (vegetarian|vegan|eggetarian|non_vegetarian)`, `MealPlan (balanced|high_protein|low_carb|keto)`, `NutritionGoal (lose_weight|maintain|gain_weight|build_muscle)`

**Messaging**
- `AppNotification` — `id, topic (steps|workout|streak|hydration|coins|challenge|reward|health|system), title, message, createdAt, read`

### 4.2 Client-side shapes with no model yet (from stores)

These are TypeScript interfaces in stores, not zod models. The API should promote them:

- `NutritionGoals` — `{ calories: 2200, proteinG: 120, carbsG: 300, fatsG: 70 }` defaults
- `NutritionPreferences` — `{ dietType: 'vegetarian', mealPlan: 'balanced', goal: 'gain_weight' }` defaults
- `QuietHours` — `{ enabled: true, start: '22:00', end: '07:00' }`
- `CategorySwitches` — 8 keys: `activity, coins, challenges, orders, offers, announcements, referrals, health` (all `true` except `health: false`)
- Reminder settings — `{ enabled, reminders[], sound: 'Default', vibration: true, repeatDays: [0..6] }`
- `StreakRun` — `{ length, start, end }`
- `MonthlyCoinSummary` — `{ earned, spent, net }`

### 4.3 Schema additions needed on day one

```ts
// DailyActivity — additive, safe under 3.5
distanceKm: z.number().nonnegative().default(0),
source: z.enum(['health_connect','healthkit','manual']).nullable().default(null),
verified: z.boolean().default(false),

// LeaderboardEntry — the board cannot highlight the viewer
isCurrentUser: z.boolean().default(false),

// Achievement — send data, not formatting (C8)
value: z.number(),   // was string "10K"; client has formatCompactNumber()

// User — the account screen needs these, and they are identity, not "highlights"
createdAt: z.string(),
country: z.string().nullable(),   // ISO-3166-1 alpha-2; drives leaderboard scope
phoneVerifiedAt: z.string().nullable(),
emailVerifiedAt: z.string().nullable(),   // §13.3 — gates spend/payout
trustTier: z.enum(['trusted','normal','watch','restricted','banned']).default('normal'),

// VerificationChallenge — one challenge type for both channels
channel: z.enum(['sms','email']).default('sms'),
target: z.string(),                       // masked: "+91••••••3210" / "a•••@example.com"

// Wallet response — coins held pending verification (§7.6)
pending: z.number().int().nonnegative().default(0),
```

### 4.4 Collections the backend adds (MongoDB)

| Collection | Purpose |
|---|---|
| `coin_ledger`, `coin_balances`, `coin_holds` | Append-only ledger + materialised balance + escrow (§8) |
| `activity_samples`, `activity_daily`, `motion_windows` | Raw health samples, per-local-day rollups, motion-signature features (§7) |
| `devices`, `device_sessions`, `app_releases`, `version_stats` | Device registry, per-device sessions, known builds, adoption (§13) |
| `health_connections`, `attestations`, `fraud_flags`, `trust_history`, `review_queue` | Provider grants, integrity verdicts, fraud layers, trust score (§7) |
| `streak_days`, `streak_freezes` | Earned/protected days; freeze grants and spends |
| `challenge_definitions`, `challenge_enrollments`, `achievements`, `user_achievements` | Catalogue vs per-user progress |
| `leaderboard_periods`, `leaderboard_scores`, `leaderboard_snapshots` | Live scores + frozen final standings |
| `shop_items`, `shop_inventory`, `orders`, `order_items`, `fulfilments`, `addresses` | Physical redemption pipeline |
| `notifications`, `notification_preferences` | Feed + consent |
| `hydration_entries`, `hydration_reminders` | Water log + schedule |
| `food_items`, `food_entries`, `nutrition_goals`, `nutrition_preferences`, `diet_plans`, `planned_meals` | Nutrition |
| `vital_readings` | HR, BP, weight (BMI derived) |
| `referrals`, `referral_codes` | Programme |
| `user_settings` | Mirror of `settingsStore` |
| `idempotency_keys`, `audit_log`, `events`, `feature_flags`, `campaigns` | Integrity, analytics, remote config, push campaigns |

Full collection schemas and indexes in [ARCHITECTURE.md §6](backend/ARCHITECTURE.md). The two properties the economy needs — *one event pays once* and *balance never negative under concurrency* — are a unique compound index on `coin_ledger` and an atomic `findOneAndUpdate({ balance: { $gte: price } }, { $inc })` on `coin_balances`, wrapped in a session transaction with the order and inventory writes.

---

## 5. Screen-by-screen specification

Every screen in the app, what it renders, where that data comes from today, what the user can do on it, and what the backend has to provide. Actions marked **[no-op]** are wired to empty handlers in the client and need both an endpoint and (usually) a screen.

### 5.1 Auth stack

#### Welcome
- **Renders:** wordmark, tagline "Move • Earn • Achieve", two buttons.
- **Backend:** none.

#### Sign In
- **Renders:** one identifier field (email **or** phone), password, "Forgot Password?", social row (Google/Apple/Facebook), perks strip ("Track Steps / Earn V-Coins / Redeem Rewards").
- **Data:** `signInSchema` — identifier accepts email or `^\+?\d[\d\s-]{6,17}$`.
- **Actions:** `signIn(identifier, password)` → `POST /auth/sign-in`. Forgot password **[no-op]** (shows "not available yet"). Social **[no-op]**.
- **Backend:** `POST /auth/sign-in` must resolve email *or* phone from one field. `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/social`.

#### Sign Up
- **Renders:** email, phone (country picker + national number), password, confirm, DOB (calendar sheet), gender (segmented: male/female/other), terms checkbox.
- **Data:** `signUpSchema` → `SignUpPayload { email (lower-cased), phone (E.164), password, dateOfBirth, gender }`. Password: 8–72 chars, ≥1 letter, ≥1 digit.
- **Actions:** `signUp(payload)` → `POST /auth/sign-up` → `VerificationChallenge` (no tokens).
- **Backend:** email/phone uniqueness (422 with field details), consent recorded from request, phone OTP via SMS, then email OTP automatically after phone verification (§13.3). Device must already be registered (§13.1). **Referral code at sign-up (built):** an optional `referralCode` on the form and `POST /auth/sign-up`; a code that matches nobody is refused as a 422 field error (`details.referralCode`) before any OTP goes out; a good one rides on the challenge and the referral opens `pending` the moment the account is created in `verify-otp` (`social.applyCodeAtSignUp` — never fails the sign-up). The Referral & Earn claim card stays for anyone who skipped it, within the 7-day window.

#### Verify OTP
- **Renders:** 6-box code input, expiry countdown, resend countdown (both driven by `expiresInSeconds` / `resendInSeconds`), safety note.
- **Actions:** `verifyOtp(code)` → `POST /auth/verify-otp` → `AuthResponse`; `resendOtp()` → `POST /auth/resend-otp` → fresh challenge; back → `cancelVerification()` (client-only).
- **Backend:** attempt limits, resend cooldowns, challenge TTL. A wrong code must leave the challenge alive. **The same screen is reused for the email OTP** that follows phone verification (§13.3) — the challenge carries `channel` and a masked `target`, and `verify-otp` is polymorphic on purpose.

### 5.2 Onboarding

#### Complete Profile
- **Renders:** name, height (cm, or ft/in picker in imperial), weight (kg/lb), unit toggle that converts typed values, "data is safe" note.
- **Data:** `completeProfileSchema` → `CompleteProfilePayload { name, heightCm, weightKg, units }`, rounded to 0.1. Client pre-checks 90–250 cm, 25–300 kg.
- **Actions:** `completeProfile()` → `POST /me/complete-profile` → `User` with `profileCompletedAt` set.
- **Backend:** re-validate ranges; this is the only endpoint that stamps `profileCompletedAt`. Also seed `vital_readings{kind:'weight'}` and derive BMI (C9, C10).
- **Photo (RULES P10):** the same `AvatarPicker` as the edit form, sized `xl` under the wordmark. Until the name field holds something the placeholder `ProfileHeroBadge` stands in its place — the picker draws initials behind the disc and has none to draw yet — and tapping it says so rather than opening a sheet that would look broken. Adding a photo here is optional and saves immediately, so it survives whatever happens to the rest of the form.

### 5.3 Main tabs

#### Home
- **Renders:** header (name, avatar, unread-bell dot), `StepGoalCard` (today's steps vs `dailyStepGoal`, edit goal **[no-op]**), `ActivityMetricsRow` (distance km, active min, calories), `WeeklyStepsChart` (7 days vs goal), `QuickActionsRow` (Analysis, Challenges, Nutrition, Health, Streaks + streak count), `HydrationCard` (today ml vs goal, quick-add), `MotivationCard` (hardcoded quote).
- **Source today:** `todayActivity`, `weeklySteps` seeds; streak from store; hydration from store.
- **Backend:** `GET /activity/today`, `GET /activity/weekly` (+`distanceKm`), `GET /streak`, `GET /hydration/today`, `POST /hydration/entries`. Optional `GET /content/motivation`. Consider one **`GET /home`** aggregate to make cold start a single round-trip.

#### Wallet ("Coins" tab)
- **Renders:** `WalletSyncNotice` (only after a failed sync: "Couldn't refresh", figures' age, Retry), `CoinBalanceCard` (balance, **pending** step coins when > 0, lifetime earned; the label's "?" opens `CoinsInfoSheet` — what coins are, the **served** rate card from `/wallet/earn-rules` via `EarnCoinsCard`, the daily cap with today's headroom or "Daily limit reached — resets at midnight" (E8f), why step coins are pending, "Spend in the shop"), `WalletActionsRow` (Shop, History → CoinHistory, Orders → Orders, Invite → Referral), `CoinsSummaryCard` (this **calendar month** earned/spent/net), `KeepGoingCard`, `EarnCoinsCard` (rate card: 10/1,000 steps, 100/workout, 175/7-day streak, 300/referral), `CoinExpiryPanel` (days left of the idle window; amber/red inside the warn thresholds; "About Coin Expiry" and the label's "?" open `CoinExpirySheet` — the countdown, the exact date, four rules worded from the server's window/warn days, "Earn coins" → Referral), `RecentTransactionsCard` (4 rows + View All → CoinHistory).
- **Source today:** `coinsStore` — a cache of the last `GET /wallet` + newest 50 rows of `GET /wallet/transactions`. Hydrated on sign-in, re-fetched on tab focus when older than 60 s (`WALLET_STALE_AFTER_MS`), and on pull-to-refresh. Every figure is the server's — month summary and expiry countdown included; there is no on-device ledger arithmetic and no local earn/spend. Before the first sync the balance card, ledger and summary are replaced by a loading state ("Couldn't load your wallet / Try again" after a failure); the shortcuts stay (D-45).
- **Backend:** `GET /wallet` (returns `monthSummary`, `expiresAt`, `expiryDaysLeft`, `expiryWindowDays`, `expiryWarnDays`, `pending`, `dailyCap`/`earnedToday`/`remainingToday`, `stepUpThreshold`), `GET /wallet/transactions?cursor=&limit=&source=`, `GET /wallet/earn-rules`.

#### Coin History (root route `CoinHistory`, from the wallet)
- **Renders:** `HistoryHeader` (back chevron, balance), `CoinSourceFilters` (All + one chip per `CoinSource`), one `CoinDayGroupCard` per local day (heading + signed day net, rows with clock time), footer spinner / "Try again" for a failed page, empty state worded for the filter.
- **Source today:** `useCoinHistory(source)` — pages `GET /wallet/transactions` 30 at a time by cursor; seeds from the store's cache when unfiltered; a stale response for a filter the user has left is discarded; after a failed page the end-reached hook stops asking and only "Try again" retries (otherwise a list re-measuring its footer becomes a request loop on a dead network).
- **Backend:** `GET /wallet/transactions?cursor=&limit=&source=` — `source` is validated against `COIN_SOURCES` (422 otherwise); the cursor is scoped to the filter. Tested in `vokve-backend/test/economy.test.ts`.

#### Shop
- **Model (RULES R1, R11–R16):** prices are money, and ⚙ `commerce.paymentMode` says how they are paid — `mixed` (default: coins towards the bill, between ⚙ `coinShareMin` 0 and ⚙ `coinShareMax` 30% of the goods), `coins` (coins alone, delivery too) or `money` (no coins) — switched from `app_config` without a client release (D-59). Every item has a `price` in paise, an `mrp` it is struck through against, `sizes` and `colors` where it comes in more than one, a `rating` summarised from its reviews, an optional `paymentMode` of its own (`coins` / `money` / `mixed`; unset follows ⚙ `commerce.paymentMode`), and server-computed `coinsMax` / `coinsMin` (the most and least coins one unit may take under the mode, at ⚙ `commerce.coinValuePaise` each, ₹0.25) and `coinPrice` (the coins-alone price). Coupons come off the goods (R16). Four shelves — **Clothes**, **Gym**, **Sports**, **Accessories** — with `subcategory`, `tags`, `featured`, `isDeal` and a `popularity` every order bumps.
- **Renders:** `ShopHeader` (heart with a dot when anything is saved, cart with the basket's unit count, avatar), `ShopSearchBar` (→ `ShopSearch`), `ShopCoinsBanner` (→ `ShopBrowse` "All rewards"), `ShopCategoryFilter` (All / Deals / 4 categories — narrows the local shelf, featured first), `FeaturedRewardsRow` of `ShopItemCard`s (art with a raised heart, stars with count or "No reviews yet", `Price` — money, struck MRP, "% off" — "up to N coins", and **Add** for a one-size item / **Choose size** for a sized one, which opens the page instead), `DailyOffersCard` (→ deals), `TopCategoriesGrid` (server counts win), `ShopAssuranceStrip`, pull-to-refresh.
- **Source today:** `shopStore` — the first 100 of `GET /shop/items`, `GET /shop/categories` and `GET /shop/config` (the till's rules, defaulted to the server's defaults before the first sync so a price split drawn on the first frame matches), refreshed on tab focus when older than 5 min. `cartStore` (`GET /cart`, written through on every change; the server's basket is always the truth because it carries the quote) and `wishlistStore` (ids on sign-in, items on demand; a heart flips at once and flips back on refusal) both hydrate with the session and reset on sign-out.
- **Backend (built — `modules/commerce`):**
  - Catalogue: `GET /shop/items?category=&subcategory=&deals=&featured=&inStock=&q=&sort=&minPrice=&maxPrice=&minRating=&cursor=&limit=` → `{ data, nextCursor, total }` (`q` word-prefix over title / description / tags / subcategory; `sort` ∈ `popular` · `rating` · `price_asc` · `price_desc` · `newest`; `minPrice`/`maxPrice` paise inclusive; `minRating` 1–5 — an unrated item never passes; `inStock` after the inventory join; opaque offset cursor), `GET /shop/categories`, `GET /shop/config`, `GET /shop/items/:id`.
  - Reviews (R15): `GET /shop/items/:id/reviews?sort=recent|top&cursor=&limit=` → `{ data, nextCursor, summary { average, count, histogram[5] }, mine }`; `PUT /shop/items/:id/reviews/me` `{ rating 1–5, title?, body 10–1000 }` creates or replaces the reader's one review (rate-limited 10/h; `verified` decided from their orders at write time; `authorName` is a first name or "A VOKVE member"); `DELETE …/reviews/me`. Every write recomputes `ratingAverage`/`ratingCount` on the item, which is what lists sort and filter by.
  - Wishlist: `GET /wishlist` (items in full, newest save first), `GET /wishlist/ids`, `PUT /wishlist/:itemId` (idempotent), `DELETE /wishlist/:itemId`.
  - Cart (R14, R16): `GET /cart` → `{ lines[{ item, quantity, size, color, addedAt }], count, quote }` (a line whose item went off sale is dropped and the drop written back; the quote is at the most coins allowed, with the basket's coupon), `PUT /cart/lines` `{ itemId, quantity, size?, color? }` (upsert by item + size + colour; 0 removes; the same checks as a checkout — `SIZE_REQUIRED` / `SIZE_INVALID` 422 with `details.sizes`, `COLOR_REQUIRED` / `COLOR_INVALID` 422 with `details.colors`, `QUANTITY_LIMIT` 422 with `details.max`), `DELETE /cart/lines/:itemId?size=&color=`, `PUT /cart/coupon` `{ code }` (only a coupon that applies now; otherwise `422 COUPON_*` with the reason; 20/h per member), `DELETE /cart/coupon`, `DELETE /cart` (lines and coupon). Each answers with the whole basket.
  - Quote (R11–R13, R16): `POST /checkout/quote` `{ lines, coins: number | 'max', couponCode? }` → `Quote`, no side effects: `subtotal` = Σ price×qty, `discount` = Σ (mrp−price)×qty, `coupon` `{ code, title, discount, problem }` (a coupon that does not apply is quoted with its `problem` and no discount), `shipping` = 0 when the goods after the coupon reach ⚙ `freeShippingAbovePaise` else ⚙ `shippingFeePaise`, `total` = goods − coupon + shipping. Then the ⚙ `commerce.paymentMode`: **mixed** — `coinsMax` = min(⌊goods × coinShareMax ÷ coinValuePaise⌋, whole coins in the wallet), `coinsMin` = ⌊goods × coinShareMin ÷ coinValuePaise⌋; **coins** — every line at ⌈price ÷ value⌉ coins, shipping likewise, the coupon in whole coins off, `inCoins { goods, discount, shipping, total }`, and `coinsMin` = `coinsMax` = that total; **money** — both 0. Each of those is worked out **per line from its item's own mode** and added up — a coins-only line takes its whole discounted price in coins, a money-only line none — with the coupon apportioned pro-rata and the total capped at what the bill is worth; `inCoins` is set only when every line is coins-only. `quote.paymentMethods` is the shop's menu kept to what this order allows (`methodsForOrder`), and it is what the payment page lists and what `resolveMethod` checks against. `coinsShort` = how far the wallet is under `coinsMin`; `coinsApplied` is kept between the two; `coinsValue` = coins × value; `payable` = total − coinsValue (never below 0); per line `coinPrice` / `lineCoins` and `image` (the item's first picture, for the till's item rows; null falls back to the emoji); `needsStepUp` when coinsApplied ≥ ⚙ `coins.stepUpThreshold`.
  - Checkout (R2–R4, R12, O8): `POST /checkout` (`requireVerifiedContacts` → validate → `idempotent`) `{ lines | fromCart: true, addressId, coins, couponCode?, paymentMethod?, stepUpToken? }` (the coupon only when the app's quote showed it applying — re-checked and refused `422 COUPON_*` rather than charged without, then claimed in the transaction). Gates in fix-order: `PURCHASES_RESTRICTED` 403, `ADDRESS_REQUIRED` 422, `CART_EMPTY` 422, `INSUFFICIENT_COINS` 422 when the wallet is under the mode's floor, `COINS_UNDER_MINIMUM` 422 `{ coinsMin }`, `COINS_OVER_LIMIT` 422 with `details.coinsMax` (the app re-quotes rather than being charged a different sum), `OUT_OF_STOCK` 409, `PAYMENT_METHOD_UNAVAILABLE` 422 `{ method, offered }` when the shop does not take it, `PAYMENT_METHOD_MISMATCH` 422 `{ method, coins, payable }` when the method and the sums disagree (`coins` with money still owing, `coins_upi` with no coins or nothing left, a gateway-only method on an order that spends coins), `STEP_UP_REQUIRED` / `STEP_UP_INVALID` 403 (the watch tier alone — spending coins asks for no code, D-66). Then one transaction: `$gte` balance decrement + `purchase` ledger row for the coins part, `$gte` stock decrement per line, `popularity` bump, the order with an address snapshot, the basket lines cleared when `fromCart`, audit. Every order is born with a `number` — `VKV` + the day + four digits, the reference a member reads out to support, checked against the day's orders rather than trusted to chance — and an `estimatedDelivery` window (⚙ `commerce.deliveryDaysMin`/`deliveryDaysMax`, 4–7 days) snapshotted at that moment so a config change never moves a promise already made. `trackingChannels` is computed on read from what can actually be delivered: `email` always, `whatsapp` only where the member asked and a provider exists, `sms` never (D-31). Items snapshot their `image` and `coinPrice` too, so a receipt draws the same row the till did, **and the split they were charged at** — `coinsUsed`, `coinsValue`, `moneyPaid` — so an order of three things says what each one cost in coins and in money (R11). An order that still owes money is born **`pending_payment`** with its coins and stock held for ⚙ `commerce.paymentWindowMinutes` (30); one the coins covered is `placed` at once. Answers `{ order, balance, payment: PaymentIntent | null }` — the gateway order is created *after* the transaction (a network call to someone else is not held inside a lock) and the order released if it fails.
  - Ways to pay (R12): ⚙ `commerce.paymentMethods` is the owner's menu, in the order the payment page lists it — `coins` (the wallet alone), `coins_upi` (the wallet and then the gateway), `upi` / `card` / `netbanking` (the gateway alone, each opening its own tab). `GET /shop/config` reports it **narrowed by the mode**: a `coins` shop keeps only `coins`, a `money` shop drops both coin methods. An unknown name, or a menu the mode empties, is refused at config load. The chosen method rides on `POST /checkout`, is checked against the quote, is stored on `order.payment.method` and comes back on the `PaymentIntent`, and for Razorpay it is sent as the gateway order's `method` so the sheet cannot be paid a way the order was not quoted for.
  - Payment (R12): `POST /orders/:id/pay` `{ providerPaymentId, signature? }` (`idempotent`) verifies the proof with the provider — `lib/payments.ts`: **`mock`** accepts any id and refunds instantly (dev/test; refused in production), **`razorpay`** creates the gateway order with our id as receipt and checks the checkout's HMAC-SHA256 `order_id|payment_id` signature (`PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) — then marks it paid and `placed`, and only then sends "Order placed". `ORDER_NOT_PENDING` / `PAYMENT_EXPIRED` 409, `PAYMENT_INVALID` 422. Paid once, paid: a second proof answers with the same order. The hourly job `expire-unpaid-orders` releases orders past their window (coins and stock back, "Order expired" notification).
  - Cancel (R5, R6): `POST /orders/:id/cancel` while `pending_payment | placed | confirmed` — one transaction puts the coins back as a `refund` row and restores stock; money already taken is refunded through the gateway after (`payment.status: 'refunded'`; a refund the gateway refuses leaves the order cancelled with the payment still marked paid, logged for support). `GET /orders/count` counts everything but `pending_payment` (R7).
  - The order page (R5): every order is read back with a `timeline` built from its `events` — each stop the member reads ("Order Placed", "Packed", "Shipped", "Delivered"), when it happened, and the ones still ahead — a `headline` for the line the page leads with, a `trackingUrl` from ⚙ `commerce.trackingUrlTemplate` with the courier's reference escaped into it, a `returns` promise from ⚙ `commerce.returnWindowDays` / `returnsNote` (eligible only inside the window after delivery), and `addressChangeable`. `GET /orders?status=` groups the states into the list's five tabs server-side. `POST /orders/:id/address` re-snapshots another of the member's addresses onto an order not yet packed (`409 ORDER_ADDRESS_LOCKED`); `POST /orders/:id/reorder` prices the order's lines as the catalogue stands now and puts back what it still has, skipping the rest with the reason.
  - Seeded catalogue + stock in `seed/data.ts` (prices in paise, sizes, list prices; `popularity` set only on insert). Tested in `test/commerce.test.ts` (catalogue filters, config, wishlist, cart, quote arithmetic, checkout → pay → cancel, coins-only orders, six concurrent buyers, step-up, tiers, expiry, reviews).

#### Product (root route `ProductDetail { id }`, from any card, the wishlist, the cart)
- **Renders:** `ShopPageHeader` (back, "Product Details", the coin balance → wallet); the gallery (photos, or the emoji until there are some, with the heart and a dot per photo) beside the title, ribbon chip, description, highlights, "Sizes Available" and the price — in coins in a coins-only shop, in rupees otherwise, with "Use up to N coins" in a mixed one; **Select Color** swatches (the first picked) and **Select Size**; **Key Features**; **Product Information** (the item's specs, then ⚙ delivery and returns lines); a bar with **You Pay** (the till's quote for one at the most coins, shipping included, or "You need N more coins") and **Redeem Now** ("Not enough coins" when the wallet is short, "Sold out" when it is).
- **Source:** the shelf's copy at once, `GET /shop/items/:id` on arrival for fresh stock (and the whole item for a deep link), `POST /checkout/quote` for the line as chosen (a sized item at its first size until one is picked — the price is the same in every size). Redeem Now → `Checkout { lines: [{ itemId, quantity: 1, size, color }] }`; a sized item without a size says "Pick a size first." The page has no basket button, quantity or reviews (D-58).

#### Cart (root route `Cart`, from the shop's header, the product page, the add-to-cart toast)
- **Renders:** `ShopPageHeader` ("My Cart", the coin balance → wallet), a green **100% Secure Redemption** banner ("Secure Checkout" in a money-only shop), one `CartLineCard` per line (art → product, title, the bin, size, colour with its swatch, unit price, a `QuantityStepper` that stops at one, the line total — in coins in a coins-only shop; "Sold out — remove it to check out"), the `CouponCard` ("Have a coupon?" → `CouponSheet`; applied with what it saves; or kept with the reason it does not apply, and Remove), the `OrderSummaryCard` (Total Items, Total Price, the coupon, delivery when charged, the coins in a mixed shop, **You Pay**, and a line on when the coins leave the wallet — or "You need N more coins"), the `CartPromiseStrip` (payment, ⚙ delivery, ⚙ returns), and a bar with You Pay and **Proceed to Checkout**, shut with the reason above it while a line is sold out or the wallet is short.
- **Source:** `cartStore` — `GET /cart` on open, `PUT /cart/lines` on every stepper change and the bin (with Undo), `PUT/DELETE /cart/coupon` from the coupon box, the server's basket taken as the truth each time (the stepper holds still while a write is in flight).

#### Shipping address (root route `ShippingAddress { fromCart: true } | { lines }`, from the cart and "Redeem Now")
- **Renders:** `ShopPageHeader` ("Shipping Address", "Where should we deliver your order?", the coin balance → wallet); **Saved Addresses** (Manage → `Addresses`) as `ShippingAddressOption` radios — label with a "Default" chip, name, address, phone, a pencil → `AddressForm { id }` — and **+ Add New Address** → `AddressForm`; **Delivery Preferences** (instructions with a 0/120 count, "Notify me on WhatsApp" only when ⚙ the server offers it, "Leave at door"); ⚙ `deliveryNotice`; "100% Secure Delivery"; a bar with **You Pay** and **Continue to Checkout** (shut until an address is chosen).
- **Source:** `addressesStore` — `GET /me/addresses` and `GET /me/delivery-preferences` on open; the radio starts on the default, a new address comes back chosen; You Pay is the basket's quote or, for one line, `POST /checkout/quote`. Continue saves the preferences (`PUT /me/delivery-preferences`) and opens `Checkout { …source, addressId, delivery }` (RULES R17).

#### Checkout (root route `Checkout { fromCart: true } | { lines }` + `addressId?`, `delivery?`, from the shipping page)
- **Renders:** `HistoryHeader`, `EmailVerificationBanner` ("place an order"), the delivery address card (the shipping page's choice, or the default, with the delivery preferences under it; Change → back to `ShippingAddress`, Add → `AddressForm`), the lines, a **Pay with coins** card (a switch with "Up to N coins (30% of the items) · you have M", a slider 0..coinsMax whose figure and "− ₹x" move at once, the step-up notice at or above the threshold), a **Summary** `PriceBreakdown`, and a sticky button: "Pay ₹x" / "Confirm & pay ₹x" (step-up ahead) / "Place order · N coins" (nothing to pay) / "Add a delivery address".
- **Source:** `POST /checkout/quote` on open at `'max'` — the coins start at their ceiling, because a user who came to spend them should not have to ask — and again after a refusal that could have changed the figures (`OUT_OF_STOCK`, `COINS_OVER_LIMIT`, `INSUFFICIENT_COINS`). The slider only moves the coins within the quote; the money that follows is the one line the contract fixes (coins × value), so the figure shown is the figure charged.
- **Confirming (`PaymentScreen`):** what the button does follows the split (R12). **Coins alone** — it reads *Redeem with Coins* and opens a sheet with the figures ("1,912 coins will be taken from your wallet… you will have 3,088 left"); the action on that sheet places the order, and nothing is sent before it. **Money alone, or coins and money** — it reads *Pay Now* and goes straight on, because the gateway's own sheet is where that order is confirmed. No OTP either way (D-66).
- **Placing (`checkoutStore.placeOrder`):** one `Idempotency-Key` per attempt. Outcomes: `placed` (order upserted, balance set, wallet + catalogue re-synced, the basket re-fetched when it was bought, toast, `replace → OrderDetail`) · `step_up_required` (only the server asks for this now — the trust gate, T5: the store asks `POST /auth/step-up`, parks the attempt, the OTP screen opens in "Confirm It's You" mode; the token that comes back resumes the **same attempt with the same key**; backing out drops it with "Checkout cancelled") · `address_required` (→ `AddressForm`) · `payment_pending` (the user closed the gateway sheet, or no gateway is wired in this build: the order is saved and can be paid from its page until the window closes) · `failed` (worded by code).
- **Paying (`services/payments.ts` → `checkoutStore`):** the `PaymentIntent` the server issued is handed to `collectPayment` — the **mock** provider answers with a made-up proof at once; **razorpay** is the one function to fill in when the SDK is added (the snippet is in the file) and until then resolves `payment_pending` with a clear message — and the proof goes to `POST /orders/:id/pay` under the key `${orderId}:pay`.

#### Wishlist (root route `Wishlist`, from the shop's header)
- **Renders:** a two-column grid of the same `ShopItemCard`s (so a saved thing can be added, or unsaved from its own heart, without opening it), "N items saved", empty state → the shop.
- **Source:** `wishlistStore.loadItems()` → `GET /wishlist` on open; the ids it carries mark every heart in the app.

#### Reviews (root routes `Reviews { itemId }` and `WriteReview { itemId }`)
- **Reviews:** `HistoryHeader` (the item's name), a summary card (average out of 5, stars, count, **Write a review** / **Edit yours**), Most recent / Highest rated, a paged list of `ReviewCard`s (`useReviews`, 10 a page, retry after a failed page), empty state → write the first.
- **WriteReview:** `GET …/reviews?limit=1` on open — a review on file fills the form and turns it into an edit with a **Delete review** (confirmed in an `ActionSheet`); `RatingPicker` (Poor → Excellent), an optional title (≤ 80), the words (10–1000 with a live count); the form refuses to send without stars or with fewer than ten characters, `PUT …/reviews/me` on submit, the catalogue re-synced so the item's stars follow, back on success.

#### Shop — Browse (root route `ShopBrowse { category?, deals?, title? }`, from a category tile, "View All", the deals card and the coins banner)
- **Renders:** `HistoryHeader` (back chevron, balance, the shelf's name, "N rewards[ in stock]"), `ShopBrowseToolbar` (subcategory chips from the shelf's `ShopCategorySummary` — hidden for deals / all; **Sort** opening an `ActionSheet` of Popular / Top rated / Price: low to high / Price: high to low / Newest; **Filters · n** opening `ShopFilterSheet`; an "In stock only" switch), a two-column `FlashList` of `ShopItemCard`s, footer spinner / "Try again" for a failed page, an empty state that offers "Clear filters" when any are set, pull-to-refresh.
- **Filters (`ShopFilterSheet`):** a price band (Under ₹300 / ₹300–₹600 / ₹600–₹1,000 / Over ₹1,000) or a min/max of the user's own in rupees (swapped if backwards), a star floor (3★ / 4★ / 4.5★ & up), Deals only, In stock only — edited as a draft and applied on "Show results" (or cleared at once), so the list rebuilds once rather than on every tap. Travel as `minPrice`/`maxPrice` (paise), `minRating`, `deals`, `inStock`.
- **Source:** `useCatalogue(query)` — pages `GET /shop/items` 20 at a time by cursor; any change to category / subcategory / sort / filters is a new list (the old query's answer in flight is discarded); a page-2 request reads the query as it is *now*; after a failed page the end-reached hook stops asking and only "Try again" retries. A card opens `ProductDetail`.

#### Shop — Search (root route `ShopSearch`, from the shop's search bar; fade transition)
- **Renders:** back chevron + an auto-focused field ("Search tees, mats, rackets…", clear ✕), the four category chips (toggle to narrow the same search), "N results for \"q\"", a two-column results grid of `ShopItemCard`s, and — while the field is empty — **Recent searches** (tap to run again, ✕ to forget) or a hint card; "Nothing for \"q\"" worded differently when a category is narrowing it.
- **Source:** the field's text becomes the request 250 ms after the last keystroke and only from 2 characters (`MIN_QUERY_LENGTH`), through `useCatalogue({ q, category }, isSearching)` — one request per settled query, never one per keystroke, and a late answer for a query the user has left is dropped. `shopSearchStore` (MMKV, on-device only, never sent) keeps the last 8 searches, newest first, case-folded de-dup; a search is remembered once its results land.

#### Orders (root route `Orders`, from the wallet's tile, the cart's footer, the shop's bag and the account's menu)
- **Renders:** `ShopPageHeader` (back, "My Orders", the coin pill → wallet), `OrderFilterTabs` (All Orders · Processing · Shipped · Delivered · Cancelled, underlined), one `OrderCard` per order — the reference with a copy tap, the day and time, `OrderStatusPill`, the art, the line's size and colour, the quantity, what it cost through `PayAmount`, one action (Track Order / Buy Again / Pay Now / View Details) and, while the parcel is still coming, the four stops — pull-to-refresh, cursor paging, a per-tab empty state → shop, footer rows → shop and Addresses.
- `OrderDetail` (`{ id }`): the reference with its copy tap, when it was placed, the pill and the delivery window, the four stops, the server's `headline` with "Track Live" where there is a `trackingUrl`, Product Details (and the bill only where there is more to it than the lines), Delivery Address with "Change" while `addressChangeable`, Order Timeline from the server's `timeline` (each stop's own time, Done / Pending, the window on the stop still ahead), Need Help? + Track Live, "Cancel order" while `cancellable` (asks first via `ActionSheet`; refund refreshes the wallet), and the Returns & Replacements row from `order.returns`. A deep link with an empty cache fetches the one order.
- **Source today:** `ordersStore` — one cached page per tab (`GET /orders?status=`), plus `GET /orders/count`, hydrated on sign-in and on open or tab change when stale. A write that changes an order's state (cancel, address change) rewrites the row wherever it is held and marks the other tabs stale, because which tab it now belongs to is the server's to say. "Buy Again" is `POST /orders/:id/reorder` and the answer replaces the basket; "Change" opens the address book with `{ select: true, orderId }`, which moves that order and leaves the default alone.

#### Addresses (root routes `Addresses` and `AddressForm`)
- **Renders:** the book (default tagged; Make default / Edit / Delete with an asking sheet) or, opened from a checkout with `select`, one "Deliver here" per address that makes it the default and returns — the checkout reads the default, so nothing rides back through the route. `AddressForm` (`{ id? }`): react-hook-form + `addressFormSchema` (six-digit PIN, trimmed lines, recipient defaults to the account holder); the first address is the default and the switch only appears once there is a choice.
- **Source today:** `addressesStore` — every write goes to the server and the list is re-read from the answer.

#### Account
- **Renders:** `AccountHeader` (bell with an unread dot), `EmailVerificationBanner`, `ProfileSummaryCard` (name, avatar, level badge, tier title, member since, a level bar reading "1,000 / 3,700 to level 19", rank "#412 of 18.9k", and the stat strip: coins, streak, badges earned, lifetime steps), `ProfileCompletenessCard` (percent, bar, the top three gaps with what each is worth — hidden at 100%), `AccountShortcutsRow` (Edit Profile, Privacy, Notifications, Appearance → local sheet, Security), `AchievementsCard` (the achievement shelf itself — `GET /achievements`, earned first, each ring opening its own screen, "View All" → the shelf), `MilestoneShelf` (the account's own seven milestones — steps, workouts, coins, orders, referrals — reached first, locked ones keeping their place with a progress bar), `PremiumUpsellCard`, `AccountMenuList` (My Orders, Wishlist, My Rewards, Streak Freeze & Restore, Health Data → HealthCheckup, Help & Support, About v1.0.0, Log Out), `DataSafetyNote`, pull-to-refresh.
- **Source (built):** `accountStore` — `GET /me/profile`, fetched on sign-in, refreshed on tab focus when older than 60 s, persisted so the tab paints its level and badges before the network answers. The coin balance comes from `coinsStore` instead: it changes on every spend and the wallet knows first. The `user` record (name, avatar) is the auth store's.
- **Backend (built — `modules/account`):** `GET /me/profile` → `ProfileSummary`, everything computed on read (RULES P9): the level and its band from lifetime coins (P4), the streak from the activity rollups (today not being active does not break the run — the day is not over), the steps, workouts and minutes from aggregates, orders and referrals from counts, rank from "how many members have earned more" (no leaderboard table needed), seven milestones each carrying `unlocked` and their progress — **never a date**, since a milestone is judged against a running total that carries no history — and completeness with its unmet `gaps` (P6). These are *not* the achievement shelf: `ChallengeMetric` is fixed to steps/calories/minutes/days/workouts (C1), so coins earned, a first order and referrals have no home in `achievement_definitions` and live here under their own name. A gap leads to the screen that can close it: a contact to Security, an address to the address book, everything else to the profile form.

#### Edit Profile (root route `EditProfile { focus? }`)
- **Renders:** `HistoryHeader`, an `AvatarPicker` card, About you (name, date of birth, gender), Measurements (height and weight with a unit toggle), Training (goal, activity level, weekly goal), one Save.
- **Photo (RULES P10):** tapping the disc opens a sheet — Take a photo / Choose from library / Remove photo, the last only once there is one. `react-native-image-picker` downscales to 512px at 0.8 quality and returns base64, which goes straight to `POST /me/avatar`; the reply is the whole `User`, so `avatarUrl` updates everywhere at once. **The photo saves on its own rather than waiting for the form's Save** — it is the only field here that is not text, nothing about it is validated against the rest of the form, and a member who picks a photo and then backs out would be surprised to find it gone. The profile summary is re-read afterwards, because completeness counts the photo. A refusal is worded by code: `AVATAR_TOO_LARGE`, a denied camera pointed at Settings, a cancelled picker says nothing at all.
- **Source:** the auth store's `user`; saved with `PATCH /me` (RULES P1 — it cannot stamp `profileCompletedAt`, so editing a weight never sends a member back through onboarding). Height and weight are typed in whichever system the member prefers and converted at the boundary, with the range checked **after** conversion (P2): 175 is a sane height in centimetres and an impossible one in inches. Tapping the unit converts what is already typed rather than clearing it. On success the profile summary is re-synced, because the level and the completeness both move with it.

#### Security (root route `Security`)
- **Renders:** the email and the phone with a verified tick or a warning and a Change each, a password row, and the devices holding a live session (make, model, OS, app version, last used, "This device"), with "Sign out N other devices" behind a confirmation.
- **Backend (built):** `PUT /me/password` (RULES O10 — revokes every refresh token but this device's and answers with the count; `PASSWORD_INCORRECT` / `PASSWORD_UNCHANGED` 422 land on their own fields), `POST /me/email` and `POST /me/phone` (RULES O11 — password first, then a code **to the new contact**; the screen parks the challenge in the auth store and opens the OTP screen, and only `verify-otp` moves the account), `GET /me/sessions`, `POST /me/sessions/revoke-others`.

#### Privacy & data (root route `Privacy`)
- **Renders:** a deletion banner when one is scheduled, three switches, "Download my data", and "Delete my account".
- **Switches (RULES P7):** Usage analytics, Personalised offers, Show my name to whoever invited me. Each one changes something the server actually does — there is nothing on this screen that only looks like a setting. A switch moves at once and moves back if the server refuses.
- **Export (P8):** `GET /me/export` returns the whole account as JSON, handed to the share sheet — the app has no file browser to point at afterwards, and a member wanting their data wants it somewhere they can keep it. One a day; `EXPORT_TOO_SOON` (429) is worded with the hours left.
- **Deletion (P5):** `POST /me/deletion` (password re-proved, optional reason) schedules it 14 days ⚙ out; `DELETE /me/deletion` calls it off; the daily `account-purge` job carries it out. While one is pending the screen leads with the way back.

#### Help & Support (root routes `HelpSupport`, `HelpTopic { title, subtitle?, category }`, `ContactUs`, `ReportIssue { category? }`, `AppGuide`, `SupportTicket { id }`)
- **Renders:** `PageHeader` ("Help & Support" / "We're here to help you" — no wallet pill; a balance has nothing to do with the question being asked), a search box, then the server's rows as tinted cards (Frequently Asked Questions, Contact Us, Report an Issue, Orders & Shipping, Coins & Rewards, Account & Login, Privacy & Security, App Guide), the "Chat with our Support Team" card carrying the server's reply-time promise, and the brand sign-off. Typing takes the page over: the rows step aside and the matching articles show in their place, searched on the server a beat behind the keystrokes.
- **The pages behind the rows:** `HelpTopic` is one shelf of articles — the same screen for every `faq` row, differing only by the category the row carried, which is why a new shelf needs no new screen; it carries the chat card at its foot and, when a shelf is empty, offers the form already set to that topic. `ContactUs` lists the channels the server sent, already assembled into links the OS opens, plus the office hours. `ReportIssue` is the ticket form as a full screen (writing wants the keyboard and no stray tap outside throwing the words away) with the member's own reports under it. `AppGuide` draws the server's chapters as numbered steps. `SupportTicket` is unchanged: the conversation as messages, with a reply box a closed ticket loses.
- **Backend (built, P12):** `GET /support/home` — the rows in ⚙ `support.topics` order with a `count` behind each shelf (an empty shelf is never sent), the channels, the hours, the reply-time promise, and `openTicketId` so "Chat Now" carries on a conversation already going. `GET /support/guide` — the guide from `support_guide_sections`, a collection like the FAQs so a screen change can be corrected the same day. `GET /support/faqs?q=&category=` — articles live in a collection, not the bundle, so support can answer a wave of the same question by writing one row; search matches the tags an article carries, which is how "expire" finds "Do my coins expire?"; `privacy` is a shelf of its own. `POST /support/tickets` attaches the app version, platform, OS and device automatically (the first two things support asks for and the last two anyone wants to type), `GET /support/tickets`, `GET /support/tickets/:id`, `POST /support/tickets/:id/replies` (a `resolved` ticket reopens; a `closed` one answers `TICKET_CLOSED` 409). All rate-limited per user.

#### About (root route `About`)
- **Renders:** wordmark, an update banner when there is one, this build's version and the minimum supported, What's new from the release notes, the four legal links, and a mailto for support.
- **Backend (built):** `GET /app/about` — the **server** judges the version rather than the app comparing strings to a constant it shipped with, so the minimum can move without a release. Exempt from the version gate along with `/health` and `/config`: this is the screen that tells a blocked build to update, and gating it would leave that build with nothing to say but "something went wrong".

### 5.4 Activity and training

#### Analytics
- **Renders:** D/W/M/Y range control, date chip + calendar, `StepsSummaryCard` (today's steps vs goal, report **[no-op]**), `StepsOverviewCard` (chart by hour / day / week / month, insights **[no-op]**), two `AnalyticsHighlightCard`s (best day, streak), `WeeklyTrendCard`, `AnalyticsCheerCard`.
- **Source today:** `todayHourlySteps` (24 values summing to `todayActivity.steps`), `weeklySteps`, `monthlyStepsByWeek` (W1–W5), `yearlyStepsByMonth` seeds.
- **Backend:** `GET /activity/range?from=&to=&granularity=hour|day|week|month` returning `{ buckets: [{label, start, steps, distanceKm, activeMinutes, caloriesBurned, verified}], best: {...} }`.

#### Workouts (present, not routed from any tab yet)
- **Renders:** FlashList of `WorkoutTemplate` cards.
- **Backend:** `GET /workout-templates`.

#### Workout Detail
- **Renders:** template title, description, minutes, muscle groups, exercise list, Start.
- **Actions:** `startWorkout(title)` + `addExercise()` per template exercise → navigates to Active Workout. Client-only.

#### Active Workout
- **Renders:** exercises, sets (reps, weight in user's units, completed toggle), rest timer, Finish, Discard. Gesture-dismiss disabled. Active session persisted so a crash loses nothing.
- **Actions:** `finishWorkout()` → local history first, then `POST /workouts`; retried later on failure.
- **Backend:** `POST /workouts` idempotent on `Workout.id`; server recomputes `totalVolumeKg`, `caloriesBurned`; pays 100 coins (with plausibility minimums, §8.2); writes the streak day. `GET /exercises` for a picker that does not exist yet.

#### Progress (present, not routed)
- **Renders:** workout history list with volume and relative dates.
- **Backend:** `GET /workouts?cursor=`.

### 5.5 Streak

#### Streak
- **Renders:** `StreakSummaryCard` (current, longest with dates, freezes available), `StreakCalendarCard` (month grid: earned vs protected days, month nav), `StreakToolsCard` (Freeze Today, Restore for 50 coins), `StreakBenefitsCard` (milestones 7/15/30/90/180 days → 50/150/300/1,000/2,000 coins, achieved against **longest**), `StreakCheerCard`.
- **Actions:** Freeze → `POST /streak/freeze` (refused with `NO_FREEZES_LEFT` / `STREAK_ALREADY_COVERED`, nothing spent); Restore → `POST /streak/restore` (the debit and the protected days in one transaction; `NOTHING_TO_RESTORE` / `INSUFFICIENT_COINS` charge nothing). The screen pre-checks only what the summary already says (`canRestore`, a synced balance below the cost) and otherwise shows the server's words.
- **Rules (RULES.md §S), on the server:** streak anchors on today *or yesterday*; restore bridges from the last run's end to yesterday, only if that end is within ⚙ 7 days; a day is earned by a plausible workout or verified steps ≥ the user's goal (⚙ `streak.earnedBy`, D-44).
- **Backend (built — `modules/streak`):** `GET /streak` → `StreakSummary` (figures, both day lists, freezes, restore gap and cost, the milestone ladder with achieved/paid, `nextMilestone`, a server-worded `howToEarn`); `POST /streak/freeze`; `POST /streak/restore` → `{ streak, balance }`. Days come from `saveWorkout` (W6) and the step rollup (`streakEarned` on the ingest answer tells the app to re-read). Milestones paid by `credit()` with `source:'streak'`; restore debits `source:'streak'` (C6). Hourly `streak-at-risk` job at 19:00 local (S10). Before the first answer the screen shows a loading state, never a placeholder streak (D-45).

### 5.6 Challenges and rewards

#### Challenges
- **Renders:** header, `ChallengePeriodFilter` (daily/weekly/monthly) + date chip + calendar, `ActiveChallengesCard` (progress bars, reward chips, View All **[no-op]**), `ChallengeRewardStrip` (How it works → Leaderboard "how" tab), `UpcomingChallengesCard` (View All **[no-op]**), `AchievementsCard` (rings, View All **[no-op]**), `ChallengeCheerCard`.
- **Source today:** `GET /challenges?date=` for the chosen day (split on `startsAt === null`, filtered by cadence on the device) and `GET /achievements`, through `useServerRead` — re-read when a step sync lands, on a pull, and remembered in memory so a reopened screen paints at once. Before the first answer each card is a loading state; a completed challenge reads "Completed ✓ · 10,400 / 10,000 steps".
- **Backend (built — `modules/challenges`, D-46):** the catalogue in `challenge_definitions`; progress from verified activity for the day's period; automatic completion once per (user, challenge, period) after each rollup / workout save, paid through `credit()` (step-derived rewards wait for step coins); badges by rule or by challenge. No claim endpoint — nothing to claim.

#### Leaderboard & Rewards
- **Renders:** two tabs. **Rewards:** `LeaderboardHeroBanner`, `RewardTiersCard` (rank 1 → 5,000 + tee + bottle; 2–3 → 3,000 + tee + mat; 4–10 → 1,000 + mat; "given every week"), `CurrentLeaderboardCard` (top 5, View Full **[no-op]**), `BestRankingsCard` (best rank + date, top-ten finishes, reward coins earned, rewards won). **How it works:** week runs Mon–Sun; steps + workouts + completed challenges count; country-scoped; rewards land Monday.
- **Source today:** `GET /leaderboard/reward-tiers` (tiers, the line under them and the how-it-works steps — all worded by the server), `GET /leaderboard` (this week's top five on the card, plus "You are #12 this week with 1,240 points." when the user is not among them), `GET /leaderboard/history` (best rank and its week, top-ten weeks, coins and gear won). Each card shows a loading state until its own answer arrives; pull-to-refresh asks all three again.
- **Backend (built — `modules/leaderboard`, D-47):** scores recounted per member per week after rollups and workout saves; country board ranked by L5; hourly close a few hours into Monday — results frozen, flagged places skipped, prizes paid (exempt from the cap; step-derived, so behind ⚙ `coins.steps.enabled`).

### 5.7 Hydration

#### Hydration
- **Renders:** header (back, reminders → HydrationReminder), `HydrationProgressCard` (glass, ml vs goal), `QuickAddRow` (presets + custom sheet), `HydrationLogCard` (today's entries, delete), `HydrationStatsCard` (best streak, daily average, goal hit %, reminder count; History **[no-op]**), `HydrationTipCard`.
- **Source today:** `hydrationStore` — a cache of `GET /hydration/today` plus a persisted **outbox**: a quick-add goes into the outbox and shows at once, the outbox is sent in order (each drink under its own id, `Idempotency-Key: drink:<id>`), every answer replaces the cached day, and the screen shows the server's day with the outbox laid over it. A 404/422 drops a change; anything else waits for the next flush (focus, pull, next log). Stats from `GET /hydration/stats`, re-read when a drink is confirmed; the tip from `GET /content/tips/hydration`. Before the first answer the progress and log are a loading state (D-45).
- **Backend (built — `modules/hydration`, D-48):** `GET /hydration/today`, `POST /hydration/entries` (idempotent on the app's id; 10–3000 ml ⚙, within the last 7 days, and refused past the day's ceiling — RULES Y1b), `DELETE /hydration/entries/:id` (soft delete, 404 if not the caller's), `GET /hydration/stats` (Y4, reminder count by Y6), `GET /hydration/days?from=&to=`, `GET /hydration/history?from=&to=`, `GET /hydration/day?date=`.
- **The ceiling (built, RULES Y1b):** every day payload carries `limits` and a nullable server-worded `caution`. `useLogWater` is the one path a drink is logged through — from the dashboard card as well as this screen — and it refuses, asks, or logs from those limits before sending; the server refuses again regardless, and a refusal it does make is surfaced as a toast rather than dropped. `HydrationCautionCard` draws the server's health note with the vitals disclaimer.
- **History (built):** "View History" opens `HydrationHistoryScreen` — range tabs (week / four weeks / three months / custom), the server's summary drawn and never recomputed, a bar per day clipped at the goal so rows compare by eye, and any row opening on that day's own drinks read-only.

#### Hydration Reminder
- **Renders:** `ReminderHeroCard` (enabled toggle, active count, next time), `ReminderDeliveryCard` (whether the reminders will actually arrive, with the one tap that fixes it), `ReminderPlanCard` (morning/afternoon/evening presets with add per slot), `CustomTimesCard` (custom times + remove menu), `ReminderSettingsCard` (sound → ReminderSound, vibration, repeat days M–S), `ReminderTipCard`.
- **Source today:** `remindersStore` — a cache of `GET /hydration/reminders`; every edit shows at once and `PUT`s the whole plan; a refusal puts the server's plan back. The default plan (presets 07:00/08:30/10:00, 13:00/15:30, 18:00/20:00, every day) is ⚙ `hydration.defaultPlan`. The tip is `GET /content/tips/reminders`.
- **Delivery (built, RULES Y6–Y7):** the phone rings the plan itself. `services/reminderScheduler` watches the plan, quiet hours, the water goal and the `health` category, and hands the result to `services/notifications`, which schedules it with notifee — one alarm per time where the plan runs every day (repeating daily), one per day-and-time where it does not (repeating weekly), nearest first up to a per-platform budget (iOS holds 64 pending requests). Alarms use AlarmManager, exact where Android allows it and inexact where it does not. A time inside quiet hours is not scheduled at all. Ids are stable (`vokve.hydration.<time>`), so re-scheduling replaces rather than duplicates, and cancelling cannot touch another feature's notification. A tapped reminder opens the Hydration screen. The screen says when nothing will arrive: health notifications off, the OS permission refused, or exact alarms not granted.
- **Backend (built):** `GET/PUT /hydration/reminders` — whole plan, (time, block) de-duplicated, clock order, ⚙ `hydration.maxReminders`; a save also records the caller's zone. `GET /hydration/reminders/sounds` lists the sounds a plan may name (⚙ `hydration.sounds`), which the picker shows filtered to the ones the build carries audio for. The minute sweep (`modules/hydration/reminders.job.ts`, RULES Y6) writes the feed row for every due reminder and pushes **only** where no install of the account has claimed local scheduling inside ⚙ `hydration.localScheduleTrustDays`.

#### Reminder Sound
- **Renders:** `ReminderSoundRow` per sound — name, what it sounds like, a tick on the one in force, and a play button that rings it as a real notification so the volume, channel and do-not-disturb rules are the ones that will apply for real.
- **Source:** `GET /hydration/reminders/sounds`, filtered to the ids this build has audio for (`constants/reminderSounds`); the bundled list when the server's has not arrived. A tap saves the plan at once — there is nothing here to change and abandon.
- **Audio:** `android/app/src/main/res/raw/<id>.wav` and the iOS bundle (`ios/vokve/Sounds`, added to the Xcode target). `default` is the phone's own sound and `silent` is none; an id with no audio in this build falls back to the phone's own rather than arriving silent.

### 5.8 Nutrition

#### Nutrition
- **Renders:** header, period/date chip + calendar, `CalorieSummaryCard` (eaten vs goal vs burned — burned reads `todayActivity.caloriesBurned`; Learn more **[no-op]**), `DailyGoalCard` (kcal/protein/carbs/fats vs goals, edit **[no-op]**), `MealsCard` (4 slots with item count, kcal, first-logged time; add per slot → AddMeal; View All → History; Tips **[no-op]**), `PreferencesCard` (diet type / meal plan / goal via action sheet; Manage → Diet Plan).
- **Source today:** `GET /nutrition/day?date=` for the chosen day (the date chip now moves the figures), with the outbox's unsent meals laid over it; targets and preferences from `GET /nutrition/profile` (`nutritionStore.profile`, a preference change `PUT`s at once); burned calories from `GET /activity/day`; the tip from `GET /content/tips/nutrition`. Loading states until each answers (D-45).
- **Backend (built — `modules/nutrition`, D-49):** `GET /nutrition/day`, `GET/PUT /nutrition/profile` (goals + preferences in one, field by field).

#### Add Meal
- **Renders:** header with coin badge, slot selector, date + time pickers, `FoodSearchRow` (search library; add custom), `FoodQuickAddRow` (4 quick-add ids), `AddedFoodsCard`, `MealSummaryCard` (totals), Save.
- **Actions:** `addEntries(drafts[])` — batched, one `loggedAt` from date + time, each food with its own id; queued in the outbox and sent as one `POST /nutrition/entries` (`Idempotency-Key: meal:<first id>`).
- **Source today:** shortcuts from `GET /foods/quick-add`; search from `GET /foods?q=` once typing pauses (250 ms), "Searching…" until it answers.
- **Backend (built):** `GET /foods?q=&limit=` (word prefix over name; the member's own foods first), `GET /foods/quick-add`, `POST /foods/custom` (private, N8 — not yet used by the app), `POST /nutrition/entries` (batch ≤ 30 ⚙, idempotent per food id, within ⚙ 30 days).

#### Diet Plan
- **Renders:** Today / Week tabs; day nav + calendar; `PlanCaloriesCard` (plan total vs goal); `PlannedMealCard` per meal (tap **[no-op]**); add meal → AddMeal; `PlanNutritionCard` (macros vs goals); week strip.
- **Source today:** `GET /diet-plan?date=` (meals, totals, `cycleLength`, `basis` — "Vegetarian · Balanced") and `GET /diet-plan/days?from=&to=` for the week ahead / behind; both re-read when a preference changes. The local plan store (and its never-called per-date extras) is gone.
- **Backend (built):** curated days in `diet_plan_templates`, each tagged with the diet types and meal plans it suits; a member's plan cycles (by date) through the days that suit both their preferences, else their diet type, else all (N7 placeholder; portion scaling to the kcal goal not built). User additions to a plan (`POST/DELETE /diet-plan/meals`) are not built — the app's "Add Meal" logs food instead.

#### Nutrition History
- **Renders:** Daily / Weekly / Custom range; day nav; `DailySummaryCard` (insights **[no-op]**); `HistoryMealCard` per slot (tap → AddMeal for that slot/date); `DayTotalsCard` list (previous 6 days or range); `RangeSummaryCard`.
- **Source today / Backend (built):** `GET /nutrition/days?from=&to=` → per-day totals + item counts, every day present (≤ 366); `GET /nutrition/day?date=` for detail; both re-read when the server confirms a change.

### 5.9 Health and vitals

#### Health Checkup
- **Renders:** header, date chip, `HealthScoreCard` (82/100 with band word; ⓘ **[no-op]**), `VitalsCard` (latest HR, BP, BMI, weight; add reading sheet; BMI guide; tap HR/BP → detail screens), `TrackProgressCard` (Trends **[no-op]**), `RecentHistoryCard` (last readings, View All **[no-op]**), `HealthTipCard`.
- **Source today:** `vitalsStore` — a cache of `GET /vitals?limit=60` and the derived BMI from `GET /vitals/latest`, plus a persisted outbox (a reading shows at once and is sent under its own id); the score from `GET /health/score` (re-read when a reading is confirmed, the server's band word on the card); the tip from `GET /content/tips/health`. BMI is no longer offered in "Add New Reading" (V1). Loading states until each answers (D-45).
- **Add reading bounds:** HR 30–220 bpm; BP systolic 60–250 / diastolic 30–150 mmHg; BMI 10–60; weight 20–350 kg.
- **Backend (built — `modules/vitals`, D-50):** `GET /vitals/latest` (newest of each kind + derived BMI + the V9 disclaimer), `GET /vitals?kind=&limit=` (newest first; no cursor yet), `POST /vitals` (idempotent on the app's id; bounds ⚙ `health.bounds`; `bmi` refused), `DELETE /vitals/:id`, `GET /health/score` (V8 with ⚙ `health.scoreWeights`, each part's points and a sentence). BMI is derived from the newest weight + profile height (C9); the newest weight also becomes `User.weightKg` (C10). Readings from HealthKit/Health Connect are not ingested yet (V10).

#### Heart Rate
- **Renders:** `HeartRateHeroCard` (latest bpm + band: <60 low, 60–100 normal, 101–120 elevated, >120 high), `LiveMeasureCard` (opens log sheet — manual entry, no camera), `HeartRateTrendCard` (7 readings), `RecentVitalReadingsCard` (View All **[no-op]**), `VitalTipCard` (**[no-op]**), ⓘ **[no-op]**.
- **Source today / Backend (built):** the store's heart-rate readings (`GET /vitals`), `POST /vitals`; the tip from `GET /content/tips/heart_rate`.

#### Blood Pressure
- **Renders:** `BloodPressureHeroCard` (sys/dia + pulse from latest HR + band: high if sys≥130 **or** dia≥80; low if sys<90 or dia<60; elevated if sys 120–129; else normal), trend, recent, tip.
- **Source today / Backend (built):** as Heart Rate with `kind=blood_pressure`; the tip from `GET /content/tips/blood_pressure`.

### 5.10 Social and messaging

#### Referral & Earn (built)
- **Renders:** header, `ReferralHeroBanner` ("earn N coins for every friend" — N served), `ReferralCodeCard` (the served code; Copy → clipboard, Share → OS sheet with the server's `shareMessage` + `shareUrl`, RULES F6), **`ClaimReferralCard`** (the invitee's side, for anyone who skipped the code at sign-up: "Skipped a friend's code at sign-up? Claim N coins" with the served invitee amount, the apply-by day and the qualifier; after applying, "N coins on the way — you joined on Asha's code, finish your first workout"; once paid, "N coins claimed"; hidden once the window has shut), `ReferralStatsCard` (successful, pending, coins earned — served), `HowReferralWorksCard` (four steps with the served amounts and qualifier), `ReferralsCard` (3 rows → View All expands → Load more pages `GET /referrals`), pull-to-refresh. Before the first sync a spinner/retry rather than seeded figures.
- **Source today:** `referralStore` — a cache of `GET /referrals/me`, hydrated on open when stale; `apply(code)` replaces it with the server's answer. Sign-out resets it.
- **Backend (built — `modules/social`):** `GET /referrals/me` → `{ code, shareUrl, shareMessage, rewards: { inviter, invitee, qualifier, monthlyInviterCap }, stats: { successful, pending, coinsEarned, rewardedThisMonth }, referrals[] (newest 20), applied: { code, inviterName, status, rewardCoins, appliedAt } | null, canApply, applyBy }`; `GET /referrals?cursor=&limit=`; `POST /referrals/apply { code }` (rate-limited 10/h; normalised upper-case, spaces/dashes dropped; 404 `REFERRAL_CODE_INVALID`, 422 `REFERRAL_SELF`, 409 `REFERRAL_ALREADY_APPLIED`, 422 `REFERRAL_WINDOW_CLOSED` after ⚙ `coins.referral.applyWindowDays` = 7). Codes: 7 chars from an alphabet without O/0/I/1 (F1), made on first need, unique-indexed. **Qualification (F3):** `qualifyReferral()` runs from every plausible workout save; a pending referral for that invitee pays both sides through `economy.credit()` (`source: 'referral'`, the source cap applies) with ⚙ `coins.referral.inviter` / `invitee` (20/20 — C2 resolved as "each side"), stamps the amounts on the referral, and notifies both under the `referrals` switch. **F4:** the inviter is paid for at most `monthlyInviterCap` referrals per calendar month (`inviterCapped` recorded, invitee still paid). `SHARE_URL_BASE` env (default `https://vokve.app/r`) builds the link. Tested in `test/referrals.test.ts`.

#### Notifications
- **Renders:** header (back, settings → NotificationSettings), `NotificationFilters` (All / Activity / Reward / System with the **server's totals** from `/notifications/counts` once synced), "Mark all N as read" (N = the server's unread) when there is anything unread, day-grouped list ("Today", "Yesterday", "3 days ago", "12 Sep"), tap → `markRead`, "Load older notifications" while the server has more pages, empty state per filter, pull-to-refresh.
- **Source today:** `notificationsStore` — the newest 50 rows of `GET /notifications` plus any pages loaded, and `counts` (per chip + unread) from `GET /notifications/counts`. Hydrated on sign-in, re-fetched on opening the centre when older than 60 s, and on pull. The bell and the chips read the server's counts (a paged feed would undercount); `markRead` decrements unread at once and `markAllRead` zeroes it — and clears rows the server still counts as unread on pages not loaded. Marks are sent to the server only for a synced feed; a refused mark stays read on the device. Sign-out resets the cache along with the wallet's.
- **Category map (server must match):** activity = steps/workout/streak/hydration; reward = coins/challenge/reward; system = health/system.
- **Backend (built — `modules/notifications`):** `GET /notifications?category=&cursor=&limit=` (category validated against the three chips, 422 otherwise; cursor scoped to the filter), `GET /notifications/counts` → `{ all, activity, reward, system, unread }`, `POST /notifications/:id/read`, `POST /notifications/read-all` (both idempotent). Producers call `notify({ userId, topic, title, message, dedupeKey?, preference?, exemptFromQuietHours? })`: the feed row is written first and always (a `dedupeKey` makes it write-once per event via a partial unique index), then the push follows consent — the topic's switch in `notification_preferences` (`PREFERENCE_OF`: coins/reward → coins, challenge → challenges, hydration/health → health, system → announcements, the rest → activity; `preference` overrides it, which is how order and referral messages ask the `orders` / `referrals` switches) decides whether, quiet hours in the user's zone decide when (`pushDeferredUntil`, flushed by the hourly tick). Delivery: see *Push delivery* under Notification Settings. Producers wired: coin expiry warning, coins expired, order placed/cancelled, referral applied/rewarded.

#### Notification Settings (built)
- **Renders:** header with coin badge, `NotificationIntroCard`, `NotificationCategoriesCard` (8 switches + Enable All), `NotificationPreferencesCard` (quiet hours sheet 22:00–07:00 default on; SMS for orders default on; email default off), `PrivacyNoteCard` (**[no-op]**).
- **Source today:** `notificationSettingsStore` — a cache of `GET /me/notification-preferences`, hydrated on sign-in and on opening the screen. Every flip shows at once and goes out as a **patch of only what changed** (`PUT`); the server's answer — the whole record — replaces the local copy, so a clamp or default it applied is what shows; a refused write puts the switch back and the screen says why in a toast. Enable All sends only the switches that were off. Before the first sync a flip stays on the device (there is no record to patch yet). Sign-out resets it.
- **Backend:** `GET/PUT /me/notification-preferences`. The **server enforces** these before any push/SMS/email: category off → feed row only; quiet hours in the user's zone → push deferred to the window's end (`flushDeferredPushes`, hourly); OTP-grade messages are exempt.

#### Push delivery (built end to end, provider behind an env var)
- **Client:** `services/push.ts` — after sign-in and device registration, asks for permission (Android 13 `POST_NOTIFICATIONS` runtime permission + Firebase's own request; iOS through Firebase), reads the FCM token and sends it with `PATCH /devices/:id { pushToken }`; `onTokenRefresh` keeps the server current; sign-out withdraws it (`pushToken: null`) so the next person on the phone hears nothing of the last. A refusal, an emulator without Play services, or a build without Firebase all leave the device token-less — feed rows only — and never reach the user as an error.
- **Server:** `lib/push.ts` + `lib/fcm.ts` — `FIREBASE_SERVICE_ACCOUNT` (the JSON or a path) wires `firebase-admin` at boot (`configurePushFromEnv`); absent, the SDK is not even loaded and sends log `push.no_provider`. Tokens FCM reports dead are retired on `devices.push.invalidAt`; a provider outage is logged and never fails the caller (the feed row is already written).

---

## 6. Endpoint catalogue

**[E]** = already called by the client, build to match. **[N]** = new. **[✓]** = built on both sides (server module + the app reads it). All under `/v1`. All authenticated unless marked.

### 6.1 Auth
| | Method + path | Body → Response |
|---|---|---|
| E | `POST /auth/sign-in` | `{ email\|phone as "email", password }` → `AuthResponse` |
| E | `POST /auth/sign-up` | `SignUpPayload` → `VerificationChallenge` |
| E | `POST /auth/verify-otp` | `{ verificationId, code }` → `AuthResponse` |
| E | `POST /auth/resend-otp` | `{ verificationId }` → `VerificationChallenge` |
| E | `POST /auth/sign-out` | → `{ ok }`; revokes this device's refresh token |
| N | `POST /auth/email/send-otp` | (auth'd) → `VerificationChallenge { channel:'email' }`. Auto-sent after phone verification; this is the resend |
| N | `POST /auth/otp/request` (public) | `{ identifier, purpose:'login' }` → `VerificationChallenge` — passwordless login on either channel |
| N | `POST /auth/step-up` | → challenge; `verify-otp` then returns a short-lived `stepUpToken` required by `/checkout` when the coins part is at or above ⚙ 1,000 coins |
| E | `POST /auth/refresh` (public) | `{ refreshToken }` → `AuthTokens` |
| N | `POST /auth/social` | `{ provider, idToken, nonce? }` → `AuthResponse` |
| N | `POST /auth/forgot-password` (public) | `{ identifier }` → `VerificationChallenge` — **a decoy for an unknown identifier** (stored, rate-limited, masked, never delivered, never echoed), so the shape and every later error are identical either way |
| N | `POST /auth/change-phone` / `POST /auth/change-email` | `{ value }` → `VerificationChallenge` to the **new** target; `verify-otp` with purpose `change_*` swaps it in and stamps `…VerifiedAt` |
| N | `POST /auth/reset-password` (public) | `{ verificationId, code, password }` → `{ ok }` — OTP-based on either channel |

`POST /auth/verify-otp` is **polymorphic on the challenge's purpose** (`signup_phone`, `verify_email`, `login`, `reset_password`, `change_phone`, `change_email`, `step_up`) and always returns `AuthResponse` (fresh tokens) so the client has one screen and one call. See §13.3.

### 6.2 Profile, account and support
| | Method + path | Notes |
|---|---|---|
| E | `GET /me` | On the launch critical path — keep < 100 ms p95 |
| E | `PATCH /me` | Must not set `profileCompletedAt` (P1) |
| E | `POST /me/complete-profile` | Only setter of `profileCompletedAt` |
| N | `GET /me/profile` | `ProfileSummary` — level, tier, rank, stats, milestones (`unlocked` + progress, no date), completeness + gaps. Computed on read (P4, P6, P9) |
| N | `GET/PUT /me/settings` | Mirror of `settingsStore`. A `dailyStepGoal` outside ⚙ `activity.goal` (3,000–20,000) is a 422 on the field; saving one stamps `stepGoalSetAt` (D-55) |
| N | `GET/PUT /me/notification-preferences` | Mirror of `notificationSettingsStore` |
| N | `GET/PUT /me/privacy` | Analytics, personalised offers, name shared with the referrer — each enforced (P7) |
| N | `PUT /me/password` | Revokes every other session; answers with the count (O10) |
| N | `POST /me/email` · `POST /me/phone` | Password, then a code to the **new** contact; `verify-otp` moves it (O11) |
| N | `GET /me/sessions` · `POST /me/sessions/revoke-others` | Devices with a live session; the current one cannot revoke itself |
| N | `GET /me/export` | The whole account as JSON, once a day (P8) |
| N | `GET/POST/DELETE /me/deletion` | Scheduled deletion with a 14-day ⚙ grace window (P5) |
| N | `GET/POST/PATCH/DELETE /me/addresses` | Shipping |
| N | `GET /support/home` | The help centre's rows (⚙ order, counts, kinds), the channels, the hours, the reply promise, the open ticket (P12) |
| N | `GET /support/guide` | The app guide as chapters of numbered steps |
| N | `GET /support/faqs?q=&category=` | Help centre, searched over question, answer and tags |
| N | `GET/POST /support/tickets` · `GET /support/tickets/:id` · `POST …/replies` | Tickets carry the app version and device automatically |
| N | `GET /app/about` | Version, update state, release notes, legal links. Open — exempt from the version gate |
| N | `POST /me/avatar` · `DELETE /me/avatar` | Base64 JSON, sniffed and capped at ⚙ 512 KB; answers with the whole `User` (P10) |
| — | `GET /media/avatars/:id` | The bytes. Open, unguessable id, `immutable` for a year (P10) |

### 6.3 Activity and health data
| | Method + path | Notes |
|---|---|---|
| E | `GET /activity/weekly` | 7 local days, oldest first, **+ distanceKm/source/verified** |
| N | `GET /activity/today` | Same shape, one day |
| N | `GET /activity/day?date=` | One day, same shape as today |
| N | `GET /activity/range` | `?from&to&granularity=hour\|day\|week\|month` → `{ points[{start,end,steps,verifiedSteps}], totals, best }`. `week` = consecutive 7-day blocks from `from` (W1–W5 of a month); `month` = calendar months, clipped |
| N | `GET /activity/config` | The phone tracker's set-up (⚙ `activity.tracker` — Health Connect read, and written with the phone's own steps per minute, A23) and sync policy (⚙ `activity.sync`), passed to react-native-step-tracker-pro as is |
| N | `GET /activity/goal` | `StepGoal`: the goal now, a suggestion (recent days or the profile's activity level, + ⚙ 2,000, up to the age/BMI target), `basedOn {age, bmi, recentSteps}`, `min/max/increment` (⚙ `activity.goal`) and `chosenAt`. Saved through `PUT /me/settings` (D-55, P11) |
| N | `GET /activity/sources?date=` | How a day was matched: each device's own count (recovered/flagged taken off), every Health Connect app with its status (`used`/`lower`/`not_counted`/`unverified`/`blocked`/`not_computed`) and a server-written note, the raw records by app, the uploads, plain-language `explanation`, and — only where ⚙ `activity.inspector.showChecks` allows — the layer scores and flags |
| N | `POST /activity/ingest/nonce` | Single-use value the next signed snapshot carries (10 min) |
| N | `POST /activity/ingest` | One day's **signed step snapshot** (react-native-step-tracker-pro `getSignedSnapshot`) + Play Integrity on request — see the example in §15. Cut to the time the account was signed in on the phone before it is scored (A22, D-56) |
| N | `GET/POST/DELETE /health/connections[/:provider]` | Provider consent + sync cursor |
| N | `GET /home` | Optional aggregate: today + weekly + streak + hydration + unread count |

### 6.4 Workouts
| | Method + path | Notes |
|---|---|---|
| E | `GET /workout-templates` | |
| E | `GET /workouts?cursor=` | Wrap in `{data,nextCursor}` |
| E | `POST /workouts` | Idempotent on `id`; recompute volume/calories; mint 100 coins; write streak day |
| N | `GET /exercises?muscleGroup=&equipment=&q=` | |
| N | `PATCH /workouts/:id`, `DELETE /workouts/:id` | Delete of a paid workout posts a `refund` row |
| N | `GET/POST /measurements` | `BodyMeasurement` — or fold into `/vitals` (C10) |

### 6.5 Streak
| | Method + path | Notes |
|---|---|---|
| ✓ | `GET /streak` | `{ today, currentStreak, longestStreak{length,start,end}, completedDays[], protectedDays[], freezesAvailable, maxFreezes, todayCovered, todayFrozen, canRestore, restoreGap[], restoreCostCoins, restoreWindowDays, milestones[{days,coins,achieved,paid}], nextMilestone, howToEarn }` |
| ✓ | `GET /streak/history?cursor=&limit=` | `{ data[{date, day\|null, status, detail, steps}], nextCursor, total }` — the record, newest first, back to the first day that ever counted. **Missed days are filled in**: a day that did not count has no row, so the walk is over the calendar rather than the table. `day` is the day's place in its own run (resets after a break); `detail` is the server's wording — the steps walked, "Freeze used", or what a restore cost, taken from the ledger. 422 on a malformed cursor or a limit above 100 |
| ✓ | `POST /streak/freeze` | Idempotent; 409 `NO_FREEZES_LEFT` / `STREAK_ALREADY_COVERED`, nothing spent; answers the summary |
| ✓ | `POST /streak/restore` | Idempotent; debit + protected days in one transaction; 422 `NOTHING_TO_RESTORE` / `INSUFFICIENT_COINS`; answers `{ streak, balance }` |
| — | `GET /streak/milestones` | Folded into `GET /streak` (`milestones`, `nextMilestone`) |

### 6.6 Wallet
| | Method + path | Notes |
|---|---|---|
| N | `GET /wallet` | `{ balance, pending, lifetimeEarned, expiresAt, expiryDaysLeft, monthSummary, dailyCap, earnedToday, remainingToday }` |
| N | `GET /wallet/transactions?cursor=&source=` | Signed amounts, newest first |
| N | `GET /wallet/earn-rules` | Serve the rate card |
| — | **No `POST /wallet/earn`** | Coins are minted only by verified server events |

### 6.7 Challenges and achievements
| | Method + path | Notes |
|---|---|---|
| ✓ | `GET /challenges?date=` | `Challenge[]` for the day (default today in the caller's zone): open ones with the period's progress, `endsOn` and `completedAt` (`startsAt: null`), then those opening within ⚙ `challenges.upcomingDays` (`startsAt` set). 422 on a malformed date |
| ✓ | `GET /challenges/:id?date=` | One challenge in full for the day: `{ challenge, period:{start,end,day,days,endsAt}, focus:{scope,label,value,target,remaining,endsAt,caption}, reward:{coins,caption,badge\|null}, rules[{id,icon,text,tone}], joined, finished, ranked, standings[] (top ⚙ `challenges.boardSize`: rank, "Aman S.", progress, completed), me\|null, cta:{label,action}, shareText }`. `focus` is the window the ring counts — a day's share of the goal, or the period where a daily share is meaningless. The rule sheet is worded from the definition in force. 404 unknown/retired, 422 on a malformed date |
| — | `POST /challenges/:id/claim` | Not built: completion is automatic (C4) |
| ✓ | `GET /achievements` | `Achievement[]` in catalogue order; `value` is a number (C7), `achievedAt` or null |
| ✓ | `GET /achievements/:id` | One badge in full: `{ achievement, title, description, about, note, unlocked, unlockedAt, progress:{basis,label,value,target,percent,caption,completedOn}, reward:{coins,via,caption,paid}, cheer:{title,message}, related[], cta:{label,action}, shareText }`. The figure is the member's **best on record** against the badge's threshold (C7), capped at 100%; a badge with no rule of its own borrows the current period of the challenge that gives it. Copy is worded from the rule in force. 404 unknown |

### 6.8 Leaderboard
| | Method + path | Notes |
|---|---|---|
| ✓ | `GET /leaderboard` | This week, the caller's country: `{ period:{id,start,end,resetsAt,country,status}, entries[] (top ⚙ 50: rank, "First L.", country, prize coins + perk, score, isCurrentUser), me:{rank,score,coins,percentile}\|null, ranked }`. Past periods are read through `/history`; no cursor yet |
| ✓ | `GET /leaderboard/history` | `{ bestRank, bestRankAchievedOn (YYYY-MM-DD), topTenFinishes, rewardCoinsEarned, rewardsWon, periods[] (newest 12) }` from frozen results |
| ✓ | `GET /leaderboard/reward-tiers` | `{ scope, tiers[{id,fromRank,toRank,label,coins,perks[]}], howItWorks[{title,detail}], note }` — worded from ⚙ `leaderboard.*` |

### 6.9 Shop, cart, checkout and orders
| | Method + path | Notes |
|---|---|---|
| N | `GET /shop/items?category=&subcategory=&deals=&featured=&inStock=&q=&sort=&minPrice=&maxPrice=&minRating=&cursor=&limit=` | `{ data, nextCursor, total }`; prices in paise with `mrp` and `coinsMax`; `q` word-prefix; `sort` popular / rating / price_asc / price_desc / newest |
| N | `GET /shop/categories` | `ShopCategorySummary[]` — count, in-stock count, subcategories per shelf |
| N | `GET /shop/config` | The till's rules: coin value, coin share, shipping, per-line cap, payment provider + key, step-up threshold |
| N | `GET /shop/items/:id` | |
| N | `GET /shop/items/:id/reviews?sort=&cursor=&limit=` · `PUT /shop/items/:id/reviews/me` · `DELETE …/reviews/me` | One review per user per item; summary + histogram; `verified` from orders |
| N | `GET /wishlist` · `GET /wishlist/ids` · `PUT /wishlist/:itemId` · `DELETE /wishlist/:itemId` | Saved-for-later; ids are what mark hearts |
| N | `GET /cart` · `PUT /cart/lines` · `DELETE /cart/lines/:itemId?size=&color=` · `PUT /cart/coupon` · `DELETE /cart/coupon` · `DELETE /cart` | The basket with its quote and coupon; lines keyed by item + size + colour |
| N | `GET /me/delivery-preferences` · `PUT /me/delivery-preferences` | `{ instructions ≤ 120, whatsappUpdates, leaveAtDoor }` — the shipping page's defaults; WhatsApp off where not offered (R17) |
| N | `POST /checkout/quote` | `{ lines, coins, couponCode? }` → `Quote` in the shop's payment mode, no side effects |
| N | `POST /checkout` | `{ lines | fromCart, addressId, coins, couponCode?, delivery?, stepUpToken? }` — one transaction (§8.5); born `pending_payment` when money is owed, `placed` when coins covered it; answers a `PaymentIntent` |
| N | `POST /orders/:id/pay` | `{ providerPaymentId, signature? }` — the gateway's proof; mock accepts, Razorpay checks the HMAC |
| N | `GET /orders?cursor=&status=all\|processing\|shipped\|delivered\|cancelled`, `GET /orders/:id`, `GET /orders/count` | The tab is the server's grouping, not a sieve over a page; count excludes `pending_payment`. Every order carries its `timeline`, `headline`, `trackingUrl`, `returns` and `addressChangeable` (R5) |
| N | `POST /orders/:id/cancel` | Coins refund row + inventory restore + gateway refund, while `status ∈ {pending_payment, placed, confirmed}` |
| N | `POST /orders/:id/address` | `{ addressId }` — moves the parcel while `status ∈ {pending_payment, placed}`; fresh snapshot, `409 ORDER_ADDRESS_LOCKED` once packed |
| N | `POST /orders/:id/reorder` | "Buy Again": the order's lines priced as the catalogue stands now and put back in the basket → `{ cart, added, skipped[] }` |

### 6.10 Hydration
| | Method + path | Notes |
|---|---|---|
| ✓ | `GET /hydration/today` | `{ date, consumedMl, goalMl, entries[] }` |
| ✓ | `POST /hydration/entries` | `{ id, ml, at? }` — idempotent on the app's `id`; answers the day. Refuses `422 HYDRATION_DAILY_LIMIT` past ⚙ `hydration.maxDailyMl` (RULES Y1b) |
| ✓ | `DELETE /hydration/entries/:id` | Soft delete; answers the day; 404 if not the caller's |
| ✓ | `GET /hydration/stats` | `{ bestStreakDays, dailyAverageMl, goalHitRatePercent, reminderCount }` |
| ✓ | `GET /hydration/days?from=&to=` | Per-day totals, every day present (≤ 366 days) |
| ✓ | `GET /hydration/history?from=&to=` | The history screen's whole answer: `{ from, to, days[], summary }` — summary computed server-side over the days that had water (RULES Y4) |
| ✓ | `GET /hydration/day?date=` | One past day's drinks, same shape as `/today` |
| ✓ | `GET/PUT /hydration/reminders` | Whole plan object `{ enabled, reminders[], sound, vibration, repeatDays }`; a `PUT` also stores the caller's zone, for the minute sweep |
| ✓ | `GET /hydration/reminders/sounds` | `{ data: [{ id, label, description }] }` — ⚙ `hydration.sounds`; the ids a plan's `sound` may hold |

### 6.11 Nutrition
| | Method + path | Notes |
|---|---|---|
| ✓ | `GET /nutrition/day?date=` | `{ date, entries[] (logged order), totals{calories,proteinG,carbsG,fatsG,fiberG}, goals }` — today in the caller's zone by default |
| ✓ | `GET /nutrition/days?from=&to=` | `[{ date, items, calories, proteinG, carbsG, fatsG }]`, every day present |
| ✓ | `POST /nutrition/entries` | `{ entries: FoodEntry[] }` with the app's ids — batch, idempotent per id; answers the first food's day |
| ✓ | `DELETE /nutrition/entries/:id` | Soft delete; answers the day; 404 if not the caller's |
| ✓ | `GET/PUT /nutrition/profile` | `{ goals, preferences }`; PUT is a partial patch of either (goals bounded: 800–6000 kcal…) |
| ✓ | `GET /foods?q=&limit=` | Word-prefix search over global + own foods |
| ✓ | `GET /foods/quick-add` | The add-meal shortcuts |
| ✓ | `POST /foods/custom` | Member-private food (N8) |
| ✓ | `GET /diet-plan?date=` | `{ date, meals[], totals, cycleLength, basis }` |
| ✓ | `GET /diet-plan/days?from=&to=` | `[{ date, meals, calories }]` (≤ 62 days) |
| — | `POST /diet-plan/meals`, `DELETE /diet-plan/meals/:id` | Not built (see Diet Plan above) |

### 6.12 Vitals and health
| | Method + path | Notes |
|---|---|---|
| ✓ | `GET /vitals/latest` | `{ heart_rate, blood_pressure, weight, bmi (derived), disclaimer }` — each a `VitalReading` or null |
| ✓ | `GET /vitals?kind=&limit=` | Newest first, ≤ 100; `kind` ∈ heart_rate / blood_pressure / weight |
| ✓ | `POST /vitals` | `{ id, kind, value, secondary?, recordedAt? }` — idempotent on `id`; bounds ⚙; `bmi` refused (V1); a newest `weight` updates the profile (V4) |
| ✓ | `DELETE /vitals/:id` | Soft delete; 404 if not the caller's |
| ✓ | `GET /health/score` | `{ score, outOf, band, factors[{id,label,weight,points,detail}], disclaimer }` — V8, weights ⚙ `health.scoreWeights` |

### 6.13 Referrals
| | Method + path | Notes |
|---|---|---|
| N | `GET /referrals/me` | Code, share URL/message, stats, recent list |
| N | `GET /referrals?cursor=` | |
| N | `POST /referrals/apply` | `{ code }` — within 7 days of sign-up, once |

### 6.14 Notifications and devices
| | Method + path | Notes |
|---|---|---|
| N | `GET /notifications?category=&cursor=` | |
| N | `GET /notifications/counts` | Totals per category, not unread |
| N | `POST /notifications/:id/read`, `POST /notifications/read-all` | |
| N | `POST /devices`, `DELETE /devices/:token` | FCM/APNs registration |

### 6.15 Platform
| | Method + path | Notes |
|---|---|---|
| N | `GET /config` (public) | Earn rates, tiers, milestones, feature flags, min app version, maintenance |
| ✓ | `GET /content/tips/:topic` | The day's tip for `motivation` (Home's line), `hydration`, `reminders`, `nutrition`, `health`, `heart_rate`, `blood_pressure` — `{ id, topic, title\|null, text }`, rotating daily in the caller's zone over the topic's active rows in `content_tips` (D-48). Replaces `GET /content/motivation` |
| N | `GET /health` (public, unauth) | Liveness |

### 6.16 Devices and versions
| | Method + path | Notes |
|---|---|---|
| N | `POST /devices/register` | `{ installId, vendorId, profile, integrity, pushToken? }` → `{ deviceId, trustTier, mustUpgrade, minVersion }`. Called on every launch; idempotent by `(user, installId)` |
| N | `PATCH /devices/:deviceId` | Heartbeat: app version/build, OS, push token, timezone, locale |
| N | `POST /devices/:deviceId/attestation/challenge` | 32 random bytes (base64url), single use, 10 min — only for the calling device |
| N | `POST /devices/:deviceId/attestation` | The Keystore key made for it: `{ keyId, publicKey, certificateChain, … }` → `{ keyId, attested, securityLevel }`. Chain checked to Google's roots (by key), challenge, package, signer, revocation list; an unattestable key is kept as `attested:false` |
| N | `GET /me/devices` | All devices on the account with last seen, app version, current flag |
| N | `DELETE /me/devices/:deviceId` | Revoke that device's refresh token(s) and push token ("sign out other device") |
| N | `GET /releases?platform=` (public) | Known builds with status; `minSupported`, `current` |
| N | `POST /events` | Product analytics batch `[{ name, props, at }]` — device/version attached server-side |

---

## 7. Steps: sources, ingestion and fraud

### 7.1 There is no server-side step API

Health Connect (Android) and HealthKit (iOS) are **on-device datastores** with no cloud endpoint. **Google Fit is not an option**: Google deprecated the Fit developer APIs and directed developers to Health Connect; the Android Fitness API stopped serving most developers during 2025 and the REST API is on a turn-down path. Verify current dates against Google's documentation, but do not build on it.

Consequence: the client is the only reader; the server can never fully trust what arrives. This is Sweatcoin's exact situation, and why their verification — not their pedometer — is the product.

### 7.2 What to borrow from Sweatcoin

| Their behaviour | Borrow? |
|---|---|
| Outdoor-only, GPS-corroborated steps (historically) | Partly — as a confidence signal, not a gate |
| **Daily credited cap** | **Yes, unconditionally.** Bounds any attack to a known number |
| Multi-signal verification on-device + server | Yes |
| Conversion ≈ 0.95 coins / 1,000 steps | Recheck Vokve's 10 / 1,000 — an order of magnitude more generous (§8.3) |
| Retroactive clawback | Yes — `refund` source exists for it |

The lesson: **the payout ceiling makes the economy safe; the detector you tune later.**

### 7.3 Architecture

```
Device                                   Server
──────                                   ──────
Health Connect / HealthKit               1. verify Play Integrity / App Attest token (+ device signals)
OS pedometer counter (cross-check)          and the registered device id
accelerometer features (L4)
  ↓ read since sync cursor               2. dedupe (user, source, sampleId)
  ↓ sample + metadata                    3. provenance filter (7.4)
  ↓ batch 15 min / foreground / bg task  4. plausibility score 0–100 (7.5)
Play Integrity / App Attest              5. store raw activity_samples (keep forever*)
  ↓                                      6. roll up activity_daily (verified vs not)
POST /activity/ingest ──────────────────►7. trust tier → caps → HOLD coins (7.6), idempotent/day
  Idempotency-Key                        8. recompute challenges, leaderboard, streak
                                         9. releaseHolds job credits after the tier window
```
*Retention policy is an open question (§12).

### 7.4 Provenance filtering — highest value, lowest effort

Both platforms say **where a sample came from and how it was recorded**. Filter **server-side on submitted metadata**, so a patched client cannot skip it.

**Health Connect** `Metadata`: `dataOrigin.packageName` (allowlist trusted writers: OS provider, Vokve, major OEM apps, known wearables), `recordingMethod` (reject `MANUAL_ENTRY`; accept `ACTIVELY_RECORDED` / `AUTOMATICALLY_RECORDED`; `UNKNOWN` = unverified), `device`.
**HealthKit**: `HKMetadataKeyWasUserEntered` (reject `true`), `sourceRevision.source.bundleIdentifier` (allowlist; `com.apple.health` is the trusted baseline), `device` (paired Watch = stronger).

### 7.5 Identifying fake steps — eight layers

No single check catches fake steps. Each layer below is cheap, independent, and produces a score contribution and zero or more `fraud_flags`. The layers run in order on every daily rollup; L0–L2 also run inline on ingest so an obviously bad batch is marked before it is stored.

| Layer | Signal | Source | What it catches |
|---|---|---|---|
| **L0 Device integrity** | Play Integrity / App Attest verdict; `isEmulator()`; root/jailbreak indicators; debug build; hooking frameworks (Frida/Xposed); mock-location enabled; developer mode; app signature mismatch | `devices.signals`, `attestations` | Emulators, patched APKs, instrumented apps, sensor-injection tools |
| **L1 Provenance** | `dataOrigin` / `sourceRevision` on allowlist or **denylist** (known step-hack packages); `recordingMethod` ≠ manual; `wasUserEntered` false; device model on sample matches registered device | sample metadata | Typed-in steps, third-party "step booster" apps writing to Health Connect |
| **L2 Statistical plausibility** | cadence ≤ 3.5/s sustained; daily ≤ 45k; stride 0.35–1.2 m when distance exists; energy ∝ steps × mass; no future/overlapping/backfilled > 7 d timestamps; clock skew ≤ 5 min; burst shape (few identical blocks) | samples, rollup | Shaken phones, replayed batches, edited timestamps |
| **L3 Cross-source corroboration** | OS pedometer counter (`CMPedometer` / `TYPE_STEP_COUNTER`) read by the app for the same window vs Health Connect/HealthKit total — ratio outside 0.7–1.3 flags; watch vs phone agreement; distance vs steps; optional coarse GPS displacement | `activity_daily.pedometerSteps`, samples | A health-store write the phone's own sensor never saw |
| **L4 Motion signature** | Client samples the accelerometer for 10 s every 5 min while steps accrue and sends **features only** — dominant frequency, variance, zero-crossing rate, peak ratio. Walking: 1.4–2.5 Hz, moderate variance; shaking: > 3 Hz, high variance; vehicle: < 1 Hz with steps present; still: no periodicity with steps present | `motion_windows` | Phone on a dog, in a dryer, on a swing, in a car |
| **L5 Temporal & behavioural** | Round-number totals; identical totals on consecutive days; > 20% of steps 01:00–05:00 local; high counts within 24 h of install; app used only to sync (no other actions); steps only on payout-relevant days | `activity_daily`, `events` | Bots and scripted uploads |
| **L6 Graph & network** | Same `installId`/`vendorId`/attestation key across accounts; same push token; IP/ASN clusters with correlated step patterns; referral rings where invitees share devices | `devices`, `referrals`, request logs | Multi-accounting, referral farms |
| **L7 Economic** | Earn→redeem velocity; redemption within minutes of first credit; address reuse across accounts; leaderboard rank jumps > 3σ week-over-week | `coin_ledger`, `orders`, `leaderboard_scores` | The payout side of every scheme above |

**Scoring.** Each layer yields 0–100; the day's `plausibility` is a weighted mean (L0 25 · L1 20 · L2 20 · L3 15 · L4 10 · L5 5 · L6 5 — L7 feeds trust, not the day). Any **hard reject** (L0 failed attestation, L1 manual entry, L2 impossible timestamps) sets `verified=false` regardless of score.

**Denylist beats allowlist for L1.** Maintain both in `app_config`: an allowlist of trusted origins (OS providers, Vokve, major OEM/wearable apps) and a denylist of packages known to fabricate steps. Unknown origins are `unverified`, not rejected — a new legitimate wearable app must not cost users their coins.

**Motion features never leave the device as raw traces** — only the five summary numbers per window. That keeps the payload tiny and the privacy story clean.

### 7.6 Trust score, tiers and coin escrow

Per-user **trust score** 0–100 = EWMA (α = 0.3) of daily plausibility, minus open-flag penalties, plus tenure and corroboration bonuses (paired wearable, verified email + phone, address on file). Stored on `users.trust` and in `trust_history`.

| Tier | Score | Step-coin hold window | Daily step cap | Effect |
|---|---|---|---|---|
| **Trusted** | ≥ 80 | 24 h | 30,000 | Full rates |
| **Normal** | 50–79 | 72 h | 30,000 | Default for new accounts after first clean week |
| **Watch** | 30–49 | 7 d | 15,000 | Review-queue entry; redemption needs step-up OTP |
| **Restricted** | < 30 | Manual release | 5,000 | No redemption, no referral/leaderboard payout; user notified with appeal link |
| **Banned** | admin | — | 0 | Balance frozen; ledger retained |

**Escrow.** Step coins are not credited directly. The rollup creates a `coin_holds` row (`pending`), the wallet shows `pending`, and a `releaseHolds` job credits it to the ledger after the tier's window **if no new red flag appeared**. A flag during the window voids the hold (`voided`, reason recorded) — nothing to claw back, because nothing was paid. Workouts, streaks, challenges and referrals credit directly; they have their own guards.

This is the Sweatcoin pattern ("coins pending verification") and it changes the economics of fraud: the attacker must sustain a clean signal for days, not seconds, and the platform's exposure is bounded by the window.

**Actions available to the fraud reviewer** (admin API): confirm/dismiss flag, adjust tier, void holds, claw back (compensating `refund` row + audit), freeze, ban, and **appeal resolution** — every action audited with before/after.

### 7.7 Honesty in the UI

`DailyActivity.verified` / `source` and the wallet's `pending` let the app show the full count and say plainly what is pending and what earned. Silently discarding steps produces support tickets; a "pending 24 h" label produces patience.

### 7.8 Offline, sync, day boundary

- Queue samples offline; flush on reconnect (`useNetworkStatus` exists).
- Sync cursor per provider in `health_connections`.
- Background: Android permission is declared; iOS needs `HKObserverQuery` + background delivery.
- Day = **local midnight** in the zone reported *at sample time*. Never re-bucket a day that already paid.

### 7.9 Rollout

1. Android first (everything but JS is wired). 2. iOS: entitlement + `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription` + review note. 3. Manual entry never mints. 4. Wearables arrive through the same stores as a confidence bonus. 5. Layers L0–L2 at launch; L3–L4 need small client additions (pedometer read, accelerometer features) and ship in the same phase; L5–L7 are server-only and run from day one in shadow.

---

## 8. The coin economy, server-side

### 8.1 Ledger

```js
coin_ledger {
  _id, userId, amount: Int (≠ 0, signed), source, title,
  referenceType, referenceId, idempotencyKey, holdId, actor, createdAt
}
index { userId, source, referenceType, referenceId } unique   // anti-double-pay: E11000 = already paid
index { userId, createdAt: -1 }

coin_balances { _id: userId, balance: Int (≥ 0), pending: Int, lifetimeEarned: Int, lastCreditAt }
coin_holds    { _id, userId, amount, source, referenceType, referenceId, releaseAfter, status, reason }
```
Append-only — the application DB role has no `update`/`remove` on `coin_ledger`. Corrections are compensating `refund` rows. `coin_balances` is a projection, reconciled nightly with `$group: { $sum: '$amount' }` over the ledger.

### 8.2 Earn rules

| Event | Rate | Mechanics |
|---|---|---|
| Steps | **0.095 per 100 verified** ⚙ (`coins.steps.unitSteps`, `coins.steps.coinsPerUnit`) | Per local day high-water mark: `owed = floor(min(verified, tierCap)/unitSteps) × coinsPerUnit − (credited + held)_today`, then clipped by `sourceCaps.steps` and the daily cap (§8.2.1). Goes to **escrow** (`coin_holds`) and is released after the trust tier's window (§7.6). Stored as milli-coins (D-27) |
| Workout | 100 | Once per workout id. Minimums: ≥ 10 min, ≥ 1 completed set. **Cap 2/day** |
| Streak | Milestone table ⚙ (7 d = 50 default; C1 resolved → config) | Idempotent by milestone, judged against longest streak |
| Referral | **20 / 20** both sides (C2 resolved) | On invitee's phone **and** email verification; voided by device-sharing (L6). Cap per inviter/month |
| Challenge | `rewardCoins` | One claim per enrolment, server-verified |
| Leaderboard | 5,000 / 3,000 / 1,000 | From frozen snapshot only |

### 8.2.1 Daily coin cap — the hard ceiling

**No user can earn more than `coins.dailyCap` coins in one local day, from all sources combined.** Default **300** ⚙ (product may set 250, 300, 500 — it is one config value, no deploy). This is the rule that bounds every bug, exploit and generous rate in this document to a known number per user per day.

Mechanics, so it cannot be bypassed:

```js
// app_config
coins: {
  dailyCap: 300,                       // hard ceiling, all sources, per local day
  monthlyCap: null,                    // optional second ceiling (e.g. 6000); null = off
  sourceCaps: { steps: 200, workout: 100, streak: 300, challenge: 300, referral: 300 },
  stepsPer1000: 10, workoutCoins: 100
}

// coin_daily_caps — one doc per user per local day, atomic
{ _id: { userId, localDay }, total: 0, bySource: { steps: 0, workout: 0, ... }, capped: 0 }

// inside economy.credit()/hold(), before the ledger insert, same transaction:
const remaining = cap.dailyCap - doc.total;                 // read
const grant = Math.max(0, Math.min(amount, remaining, sourceCapRemaining));
if (grant === 0) { record capped += amount; return { granted: 0, reason: 'DAILY_CAP_REACHED' }; }
await coin_daily_caps.findOneAndUpdate(
  { _id, total: { $lte: cap.dailyCap - grant } },           // conditional — two concurrent credits cannot both pass
  { $inc: { total: grant, [`bySource.${source}`]: grant, capped: amount - grant } },
  { upsert: true, session });
// then coin_ledger.insertOne({ amount: grant, ... })
```

Rules:
- The cap counts **credits and holds together** — a held step coin consumes cap the day it is earned, not the day it is released, so escrow cannot be used to stack days.
- Partial grants are allowed: if 40 coins of cap remain and a workout is worth 100, the user gets 40 and the ledger title says "Push Day completed (daily limit reached)". The remaining 60 are **dropped, never carried over**.
- Order is first-come: whichever event arrives first takes the cap. Steps accrue through the day, so with a 300 cap and a 200 step cap, a user still has 100 for a workout.
- Per-source caps must each be ≤ `dailyCap`; the config validator rejects otherwise. The sum of source caps may exceed the total — that is the point of the total.
- Reaching the cap is not a fraud signal by itself; it is logged (`capped` counter) and the wallet shows "Daily limit reached — resets at midnight".
- Refunds and leaderboard payouts are **exempt** (a refund restores what was already counted; a weekly prize is a period reward, not daily earning). Everything else — steps, workout, streak, challenge, referral — is inside the cap.
- `GET /wallet` returns `dailyCap`, `earnedToday`, `remainingToday` so the client can show the meter honestly.

With the 300 default: a 20k-step day (200) + one workout (100) fills the cap; a streak bonus that day gets 0 and is dropped. If product wants streak/challenge bonuses to always pay, raise `dailyCap` or lower `sourceCaps.steps` — that is a product tuning question, answerable from one config screen.

### 8.3 Sanity-check the rate

Owner set steps to **0.095 per 100 = 0.95 / 1,000**, matching Sweatcoin. A 10k/day user now earns ~9.5 coins/day, ~285/month from steps. **That makes the inherited non-step rates look wrong** — one workout (100) is worth ten days of walking, and the shop's 250–450-coin items are a month of steps but three workouts. See D-32: rebalance `coins.workout`, `coins.streakMilestones`, shop prices and `coins.dailyCap` together, from one config screen.

### 8.4 Expiry

90-day idle window (⚙ `coins.expiryDays`), reset on any credit. **Implemented:**

- `GET /wallet` returns `expiresAt` (null when there is nothing to expire — never earned, or already swept: RULES E11), `expiryDaysLeft` (= window − whole days idle, so a credit a minute ago reads as the full window), `expiryWindowDays` and `expiryWarnDays` (⚙ `coins.expiryWarnDays`, default `[14, 3]`) — the client hardcodes none of them.
- `expireIdleWallets(now)` in `economy/wallet.service.ts`: every wallet with `balanceMc > 0` and `lastCreditAt ≤ now − window` is zeroed inside a transaction with one compensating `refund` row (`referenceType: 'expiry'`, `referenceId: lastCreditAt`, title "Coins expired after 90 days of inactivity", actor `system:expiry`). Idempotent: the ledger's unique index refuses a second row for the same credit, and the balance is only zeroed when still equal to what was read, so a credit landing mid-sweep keeps its coins. `lastCreditAt` is left as evidence; `pending` is untouched.
- `src/jobs/scheduler.ts`: an hourly tick inside the API process runs the daily jobs once per UTC day, claiming `jobs:<name>:<day>` in the KV first so two instances cannot both sweep. Started from `index.ts` and `dev:memory`. A second, minute-level tick runs the hydration reminder sweep — a reminder set for 07:15 cannot be sent by an hourly job — and claims each minute on the plan document (`lastSentMinute`) rather than in the KV, so a race between instances means one of them sends.
- Dev only: `POST /dev/jobs/coin-expiry { now?: ISO }` runs the sweep as of a chosen date.
- **Warnings (E10):** `warnExpiringWallets(now)` runs daily before the sweep and calls `notify()` for every wallet with coins sitting exactly on a warn day (`expiryWarnDays`, default 14 and 3) — "Your coins expire in 14 days". Keyed `coin-expiry-warn:<lastCreditAt>:<daysLeft>`, so each warning lands once per idle stretch and never after the user earns (the key then names a credit with no window). The sweep itself writes "Your coins have expired" (`coin-expired:<lastCreditAt>`). In the app the panel turns amber at the outer threshold and red at the inner one. Dev: `POST /dev/jobs/coin-expiry-warn { now? }`.

### 8.5 Spending is one transaction

```js
preconditions (outside txn): emailVerifiedAt && phoneVerifiedAt && address && trust.tier ≥ 'normal'
                             && (price < 1000 || valid stepUpToken)
await session.withTransaction(async () => {
  const bal = await coin_balances.findOneAndUpdate(
    { _id: userId, balance: { $gte: price } },
    { $inc: { balance: -price } }, { session, returnDocument: 'after' });
  if (!bal) throw new ApiError(422, 'INSUFFICIENT_COINS', { required: price, balance });
  const inv = await shop_inventory.findOneAndUpdate(
    { _id: itemId, onHand: { $gte: qty } }, { $inc: { onHand: -qty } }, { session });
  if (!inv) throw new ApiError(409, 'OUT_OF_STOCK');
  const order = await orders.insertOne({ userId, status: payable > 0 ? 'pending_payment' : 'placed', items, coinsUsed: coins, payable, addressSnapshot }, { session });
  await coin_ledger.insertOne({ userId, amount: -price, source: 'purchase',
    referenceType: 'order', referenceId: order.insertedId, idempotencyKey }, { session });
  await audit_log.insertOne({ ... }, { session });
});
```
The conditional `$gte` filter is the overspend guard; the transaction makes the four writes all-or-nothing; the ledger's unique index makes a retried request a no-op.

---

## 9. Scheduled jobs

| Job | Cadence | Purpose |
|---|---|---|
| Activity rollup + step holds | Hourly + local midnight | `activity_daily`, `coin_holds` |
| Trust score update | After each rollup; nightly | `users.trust`, `trust_history` |
| Release holds | Every 15 min | Credit escrowed step coins past their window with no new flags |
| Version stats / stale devices / push-token cleanup | Daily | `version_stats`, `devices` |
| Streak evaluation | Local midnight | Earned / protected / broken |
| Challenge progress | 15 min | Recompute; mark claimable |
| Challenge rollover | Daily/weekly/monthly | Expire, open upcoming |
| Leaderboard recompute | 15 min | Live scores |
| Leaderboard close + payout | Monday 00:00 local-country | Snapshot, pay, notify |
| Diet plan generation | On preference change + weekly | 7-day plan per user |
| Health score | Daily | From vitals + activity + nutrition |
| Coin expiry warn / sweep | Daily | 14d, 3d, then zero — **built** (`jobs/scheduler.ts` → `warnExpiringWallets`, `expireIdleWallets`); feed rows + push via `notify()` |
| Flush deferred pushes | Hourly | Sends pushes quiet hours held back — **built** (`flushDeferredPushes`) |
| Reconciliation | Nightly | Ledger vs balances |
| Fraud sweep | Nightly | Re-score, flag, queue clawbacks |
| Hydration reminders | Every minute | Per member, on their own clock — **built** (`hydration/reminders.job.ts`); feed row always, push only where no install rings it locally (RULES Y6–Y7) |
| Workout / streak-at-risk push | Per user schedule | Respect quiet hours + categories (streak-at-risk **built**) |
| Inventory alerts | Daily | Low stock |

All idempotent and safe to re-run.

---

## 10. Security and compliance

- **Health data** (steps, weight, HR, BP, DOB, gender) is special-category data under GDPR Art. 9, India's DPDP Act, and comparable regimes. Granular revocable consent per provider; encrypted at rest; separate schema; minimisation (no location unless used for verification, then coarse and short-lived).
- **Apple HealthKit terms** forbid advertising use and third-party disclosure without consent. **Health Connect** requires a reviewed data-use policy and the rationale screen (already present).
- **Vitals are medical-adjacent.** The BP/HR band copy ("speak to a doctor") is fine as wellness guidance; do not add diagnosis language server-side. Keep a disclaimer in `GET /health/score`.
- `DELETE /me` and `GET /me/export` are requirements, not features.
- API: TLS 1.2+, pinning on auth + ingest; rate limits tightest on `/auth/*` (SMS costs money) and `/activity/ingest` (mints coins); Argon2id; ownership checks on every `:id`; server-side bounds on every numeric input; attestation on ingest; min-app-version gate; audit log on every coin mutation; alerts on drift, ingest spikes, device sharing, referral clusters.
- **Devices:** refresh tokens are bound to a device; a refresh from another device revokes the token and notifies the user. New-device sign-in triggers a push/email ("New sign-in on Pixel 8"). Users can list and revoke devices. Max 5 active devices per account ⚙.
- **Email + phone both OTP-verified** before any coin spend or payout; step-up OTP above 1,000 coins ⚙. OTP codes hashed, 5 attempts, 5-minute TTL, per-target/IP/device limits on both channels.
- **Dev flags** `bypassAuthInDev` and `useMockApi` are `__DEV__`-guarded (correct). Add a CI assertion that both are `false` in source on release branches.

---

## 11. Delivery order

Six phases, detailed in [PHASES.md](backend/PHASES.md): **(1)** make the four existing contracts real → **(2)** step ingestion, observe only → **(3)** server ledger + minting → **(4)** streaks, challenges, notifications, hydration, nutrition, vitals → **(5)** leaderboard, shop, orders, fulfilment, referrals → **(6)** iOS HealthKit parity + hardening.

---

## 12. Open questions for product

1. C1 — 7-day streak: 175 repeating or 50 one-off?
2. C2 — referral: 300 to inviter on first workout, or 20 to each side on verification?
3. C5 — leaderboard score formula (RULES.md §L proposes one).
4. Coin rate — modelled cost per MAU at 10 / 1,000?
5. Leaderboard country — signup, locale, or IP? Movers?
6. Shipping — who fulfils, which countries, who pays duties?
7. Premium — subscription or multiplier? Needs IAP + receipt validation.
8. Manual step entry — offer at all?
9. Health score — which factors, what weights? (RULES.md §H proposes)
10. Diet plan — server-generated from preferences, or curated rotations per (dietType × mealPlan)?
11. Food database — licence one (e.g. a regional nutrition DB) or seed and grow from user entries?
12. Vitals from wearables — ingest HR/weight from HealthKit/Health Connect in v1, or manual only?
13. Raw sample retention — months (minimisation) or years (fraud)?
14. Email OTP gating — soft gate (session after phone; email required before spend/payout — the default) or hard gate (both OTPs at sign-up)?
15. Motion-signature sampling (L4) — acceptable battery cost? Proposed 10 s every 5 min only while steps accrue.
16. Escrow windows — 24 h / 72 h / 7 d per tier acceptable to product, and how is "pending" worded in the wallet?

---

## 13. Devices, versions and email verification

### 13.1 Device identity

The client has **no device id today**; `react-native-device-info` is installed and unused. Three ids are collected, each for a different job:

| Id | Source | Stable across | Used for |
|---|---|---|---|
| `installId` | UUIDv4 generated on first launch, stored in Keychain (iOS) / Keystore-backed storage (Android) | Reinstall on iOS; app updates on both | **Canonical.** Becomes `X-Vokve-Device-Id` after registration |
| `vendorId` | `DeviceInfo.getUniqueId()` — `identifierForVendor` / `ANDROID_ID` | Reinstall (Android factory reset excepted) | Re-install correlation, device-sharing detection |
| attestation key | App Attest `keyId` / Play Integrity device verdict | Hardware | The one id a cheater cannot mint |

`POST /devices/register` upserts by `(userId, installId)`, links the other two, verifies attestation, records signals (`isEmulator`, rooted, debug, hooking, mock-location), and returns the server `deviceId`. Every later request carries it in the header. A device seen on ≥ 3 accounts is flagged (L6).

### 13.2 Device information and version tracking

Registered per device and refreshed on heartbeat: brand, manufacturer, model, device name, OS version, emulator/tablet flags, memory, carrier, locale, timezone, screen, app version, build, bundle id, first-installed version, push token.

Every request logs `deviceId`, `platform`, `appVersion`, `build`, `osVersion`. `app_releases` lists known builds with a status; `GET /config` returns `minVersion` per platform; a blocked build gets `426 UPGRADE_REQUIRED` with a store link. `version_stats` materialises DAU/installs/crashes per version daily so adoption of a release — and whether a fraud pattern correlates with a build — is one query.

### 13.3 Email verified by OTP

Sign-up already proves the phone with an OTP. Email is now proven the same way:

1. `POST /auth/verify-otp` (phone) succeeds → `phoneVerifiedAt` set, session issued, **and** an email challenge is created and sent automatically.
2. The app shows the same OTP screen with `channel: 'email'` and the masked `target`. `POST /auth/email/send-otp` resends.
3. `POST /auth/verify-otp { verificationId, code }` → `emailVerifiedAt` set → `AuthResponse`.
4. Until `emailVerifiedAt` is set the user can use the app but **cannot redeem, receive referral or leaderboard payouts, or reset a password by email**. A banner on Wallet/Shop says so. (D-20 — product may choose a hard gate at sign-up instead; it is a one-flag change.)

One `otp_challenges` collection with `channel` and `purpose`; codes are 6 digits, hashed, 5-minute TTL, 5 attempts, 30 s resend cooldown, 3 resends/hour, per-target and per-IP limits on both channels. A code for one purpose can never verify another. The same mechanism serves passwordless login, password reset, phone/email change, and step-up before large redemptions.

---

## 14. Advanced features

Beyond the screens. Each is small on its own; together they are what make the product operable at scale. Phase tags refer to [PHASES.md](backend/PHASES.md).

| # | Feature | What it is | Endpoints / collections | Phase |
|---|---|---|---|---|
| 1 | **Multi-device session management** | Devices listed on the account; revoke one; new-device alerts; refresh tokens bound to device | `GET/DELETE /me/devices`, `devices`, `refresh_tokens.deviceId` | P1 |
| 2 | **Passwordless OTP login** | Sign in with a code to phone or email; no password needed | `POST /auth/otp/request`, `verify-otp` purpose `login` | P1 |
| 3 | **Step-up verification** | OTP re-auth before redemptions ≥ 1,000 coins ⚙, address changes, device revocation | `POST /auth/step-up`, `stepUpToken` | P5 |
| 4 | **Trust score & coin escrow** | Per-user tier; step coins held 24 h–7 d before release; voided on new flags | `coin_holds`, `users.trust`, `trust_history`, `releaseHolds` job | P3 |
| 5 | **Fraud review queue** | Prioritised queue of flagged accounts with evidence, one-click actions, appeals | admin `GET /fraud/queue`, `POST /fraud/:id/{confirm,dismiss,void,clawback,ban}` | P3 |
| 6 | **Offline-first sync** | One `POST /sync` with per-collection cursors; upsert by `clientId`, LWW by `updatedAt` | `POST /sync`; `clientId` unique indexes on hydration/food/vitals | P4 |
| 7 | **Product analytics events** | Batched client events with device/version attached; exported nightly to a warehouse | `POST /events`, `events` (TTL 400 d) | P1 |
| 8 | **Remote config, flags, cohorts** | Every ⚙ value; percentage rollouts; cohorts by tier/country/version; kill switches | `GET /config`, `app_config`, `feature_flags` | P0→ |
| 9 | **Push campaigns & segmentation** | Offers/announcements to a segment (country, tier, inactivity, version) with quiet-hours respect and per-category consent | `campaigns`, admin `POST /campaigns` | P4 |
| 10 | **Weekly insights digest** | Push/email: steps vs last week, health score trend, streak, nutrition adherence | `weeklyDigest` job | P4 |
| 11 | **Referral deep links & attribution** | Universal/App Links `vokve.app/r/CODE` → server redirect page → store → deferred attribution by `installId`/`vendorId` on first register | `GET /r/:code`, `referrals.attribution` | P5 |
| 12 | **KYC-lite before shipping** | Verified email + phone + address + trust ≥ Normal + step-up above threshold | precondition on `/checkout` | P5 |
| 13 | **Version gating & adoption** | `app_releases` statuses; `426` on blocked builds; adoption dashboard; fraud-by-build view | `GET /releases`, `version_stats` | P1 |
| 14 | **Admin console API** | User 360 (devices, ledger, holds, flags, orders, samples), order ops, config editor, read-only impersonation for support | `apps/admin-api` | P3→P5 |
| 15 | **Data lifecycle automation** | Retention jobs per collection, export bundles, deletion with legal hold, consent log | `retention` job, `users.flags.legalHold` | P1, P6 |
| 16 | **Real-time updates (optional)** | SSE stream for wallet/leaderboard changes so the app does not poll | `GET /stream` | P6 |
| 17 | **Motion-signature verification** | Client-side accelerometer features (L4) — the strongest cheap signal against shaken phones | `motion_windows` | P2 |
| 18 | **Streak insurance (premium hook)** | Auto-freeze on missed day for subscribers; the first feature a premium tier would sell | `streak_freezes.reason='auto'` | later |

---

## 15. Appendix — reference pairs

**Sign up → OTP**
```http
POST /v1/auth/sign-up
{ "email":"asha@example.com","phone":"+919876543210","password":"walk1000steps",
  "dateOfBirth":"1994-03-21","gender":"female" }
200 { "verificationId":"vrf_01HZX","phone":"+919876543210","codeLength":6,
      "expiresInSeconds":300,"resendInSeconds":30 }
```

**Device registration**
```http
POST /v1/devices/register
{ "installId":"9b2f…","vendorId":"A1B2…","platform":"android",
  "profile":{ "brand":"Google","model":"Pixel 8","osVersion":"14","isEmulator":false,"isTablet":false,
              "totalMemoryMb":8192,"locale":"en-IN","timezone":"Asia/Kolkata",
              "app":{ "version":"1.0.0","build":"42","bundleId":"com.vokve" } },
  "integrity":{ "provider":"play_integrity","token":"…" },
  "pushToken":"fcm:…" }
200 { "deviceId":"dev_01HZ…","trustTier":"normal","mustUpgrade":false,"minVersion":"1.0.0" }
```

**Email OTP (after phone verification)**
```http
POST /v1/auth/email/send-otp
200 { "verificationId":"vrf_02AB…","channel":"email","target":"a•••@example.com",
      "phone":"", "codeLength":6,"expiresInSeconds":300,"resendInSeconds":30 }

POST /v1/auth/verify-otp
{ "verificationId":"vrf_02AB…","code":"731904" }
200 { "user":{ …, "phoneVerifiedAt":"…","emailVerifiedAt":"2026-09-13T10:31:00Z" }, "tokens":{ … } }
```

**Activity ingest** — one day, signed on the phone by the attested Keystore key. Only what is inside `signedPayload` is trusted; it is the tracker's `VerificationSnapshot` (schema 2): the phone's own count, every Health Connect origin unresolved, the day's minutes, motion windows and raw records, the clock, and the nonce.
```http
POST /v1/activity/ingest/nonce
200 { "nonce":"Qm9vdHMgb24gdGhlIGdyb3VuZCBhbmQgYSB3YXRjaA","expiresAt":"2026-09-13T07:40:00Z" }

POST /v1/activity/ingest
Idempotency-Key: <uuid per attempt>   X-Vokve-Timezone: Asia/Kolkata
{ "date":"2026-09-13",
  "snapshot":{ "keyId":"5f2c…","algorithm":"SHA256withECDSA","value":"MEUCIQ…","attested":true,
               "signedPayload":"{\"schemaVersion\":2,\"date\":\"2026-09-13\",\"deviceSteps\":6190,…,\"nonce\":\"Qm9v…\",\"signedAt\":1757731800000}",
               "payloadSha256":"9b1d…" } }
403 { "error":{ "code":"INTEGRITY_REQUIRED","message":"…","details":{ "cloudProjectNumber":123456789012 } } }

… the same snapshot again, with a token bound to its payloadSha256 (or { "error":"PLAY_STORE_NOT_FOUND","retryable":false }):
{ "date":"2026-09-13","snapshot":{ … },"integrity":{ "token":"…" } }
200 { "day":{ "date":"2026-09-13","steps":6245,"verifiedSteps":6190,"distanceKm":4.3,
              "activeMinutes":48,"caloriesBurned":180.5,"workoutsCompleted":0,
              "source":"device","verified":true },
      "duplicate":false,"coinsHeld":0,"releaseAfter":null }
```
`ATTESTATION_REQUIRED` (403) and `INTEGRITY_REQUIRED` (403) are answered before the nonce is spent, so the phone resends the same snapshot; `NONCE_INVALID` (409) means take a new nonce; every 422 (`SNAPSHOT_INVALID`, `SNAPSHOT_SIGNATURE_INVALID`, `SNAPSHOT_DATE_OUT_OF_RANGE`) means drop the day. The `Idempotency-Key` is one per attempt — a resend with a token is a new attempt — and the snapshot itself is deduped on its hash (`duplicate:true`). `coinsHeld` stays 0 while ⚙ `coins.steps.enabled` is off (Phase 2).

**Nutrition batch**
```http
POST /v1/nutrition/entries
Idempotency-Key: …
{ "entries":[{ "slot":"breakfast","name":"Oats (Cooked)","portion":"1 Cup (150 g)",
  "calories":150,"proteinG":5,"carbsG":27,"fatsG":3,"fiberG":4,
  "loggedAt":"2026-09-13T08:05:00+05:30","foodItemId":"fl-oats" }] }
200 { "data":[{ "id":"fe_01HZ…", … }], "day":{ "date":"2026-09-13","totals":{…} } }
```

**Vital**
```http
POST /v1/vitals
{ "kind":"blood_pressure","value":118,"secondary":76 }
200 { "id":"vt_01HZ…","kind":"blood_pressure","value":118,"secondary":76,
      "recordedAt":"2026-09-13T09:30:00Z","band":"normal" }
```

**Checkout — coins over the quote's ceiling, then a placed order awaiting payment**
```http
POST /v1/checkout
{ "lines":[{"itemId":"cap","quantity":1,"size":null}],"addressId":"adr_01HZ","coins":900 }
422 { "error":{ "code":"COINS_OVER_LIMIT","message":"Up to 538 coins can go towards this order.",
                "details":{"coinsMax":538,"requested":900} } }

POST /v1/checkout
{ "lines":[{"itemId":"cap","quantity":1,"size":null}],"addressId":"adr_01HZ","coins":300 }
200 { "order":{ "id":"ord_01HZ…","status":"pending_payment","subtotal":44900,"discount":15000,"shipping":4900,
                "total":49800,"coinsUsed":300,"coinsValue":7500,"payable":42300,
                "payment":{"provider":"mock","status":"pending","amount":42300,"currency":"INR",
                           "providerOrderId":"mockord_ord_01HZ…","paidAt":null,"expiresAt":"2026-09-18T10:15:00Z"}, … },
      "balance":940,
      "payment":{ "provider":"mock","orderId":"ord_01HZ…","providerOrderId":"mockord_ord_01HZ…",
                  "amount":42300,"currency":"INR","keyId":null,"expiresAt":"2026-09-18T10:15:00Z" } }

POST /v1/orders/ord_01HZ…/pay
{ "providerPaymentId":"pay_ABC","signature":"…" }
200 { "order":{ "id":"ord_01HZ…","status":"placed","payment":{"status":"paid","paidAt":"2026-09-18T09:47:12Z", …}, … },
      "balance":940 }
```

**Wallet**
```http
GET /v1/wallet
200 { "balance":1240,"pending":60,"lifetimeEarned":2140,"expiresAt":"2026-12-12T00:00:00Z",
      "expiryDaysLeft":90,"monthSummary":{"earned":935,"spent":700,"net":235},
      "dailyCap":300,"earnedToday":160,"remainingToday":140 }
```

---

*Derived from a full read of the client at `fdbc4b0` — 30 screens, 13 stores, 4 API groups. Every "current state" claim is traceable to a file named in the text.*
