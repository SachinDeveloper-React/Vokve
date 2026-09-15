# VOKVE Backend — Rules

**Version:** 1.1 (MongoDB) · **Related:** [BACKEND.md](../BACKEND.md) · [PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [PHASES.md](PHASES.md) · [MEMORY.md](MEMORY.md)

Every rule is numbered so a test, a PR, or a support ticket can cite it. Part A is **business rules** — what the product does. Part B is **engineering rules** — how the code that implements Part A must behave. Values marked ⚙ live in remote config (`GET /config`) and may change without a deploy; values marked 🔒 are structural and change only with a client release.

Where the client already implements a rule, the source file is cited; the server ports it exactly.

---

# Part A — Business rules

## §E · Economy

| # | Rule | Source / note |
|---|---|---|
| E1 | Coins are **decimal to 3 places**, stored as integer **milli-coins** (1 coin = 1,000 mc) so no float arithmetic ever touches a balance. API returns decimal numbers; UI shows 2 decimals. | D-27 — client `amount` becomes `number()` |
| E2 | The ledger is append-only. Corrections are compensating rows with `source: 'refund'`. Rows are never updated or deleted. | |
| E3 | Balance = Σ ledger. `coin_balances` is a cache reconciled nightly; drift ≠ 0 is a P1 incident. | |
| E4 | Balance is never negative. A debit that would go below zero fails before writing anything. | `coin_balances.balance >= 0` |
| E5 | `lifetimeEarned` = Σ positive rows. Spending never reduces it. | `coinsStore.earnedOf` |
| E6 | Coins are minted only by the system, only from a verified event, only through `economy.credit()`. There is no client-callable credit endpoint and no admin "add coins" without a ledger row and audit entry. | |
| E7 | One event pays once: unique compound index `{ userId, source, referenceType, referenceId }` on `coin_ledger` and on `coin_holds`. A duplicate insert (`E11000`) is the idempotent no-op, not an error to the caller. | |
| E8 | **Hard daily ceiling.** No user earns more than `coins.dailyCap` ⚙ (default **300**) per local day from all sources combined. Enforced inside `economy.credit()`/`hold()` by a conditional `findOneAndUpdate` on `coin_daily_caps` (`total ≤ cap − grant`) in the same transaction as the ledger insert — two concurrent credits cannot both pass. | BACKEND §8.2.1 |
| E8a | Holds count toward the cap on the day earned, not the day released. | |
| E8b | Partial grants: `grant = min(amount, dailyRemaining, sourceRemaining)`; the remainder is dropped, never carried over; the ledger title is suffixed "(daily limit reached)". | |
| E8c | Per-source caps ⚙ (steps 200 · workout 100 · streak 300 · challenge 300 · referral 300 by default) each ≤ `dailyCap`; config validator rejects otherwise. | |
| E8d | Exempt from the daily cap: `refund` rows and leaderboard period payouts. Nothing else. | |
| E8e | Optional `coins.monthlyCap` ⚙ (null = off) applies the same way over the calendar month. | |
| E8f | Hitting the cap is not a fraud signal; it is counted (`capped`) and shown to the user as "Daily limit reached — resets at midnight". `GET /wallet` returns `dailyCap`, `earnedToday`, `remainingToday`. | |
| E9 | Idle expiry: if no credit for **90 days** ⚙, the whole balance is zeroed with one `refund` row. The window resets on **any** credit. | `COIN_EXPIRY_WINDOW_DAYS`, `coinsStore.expiryDaysLeft` |
| E10 | Expiry warnings are sent at 14 and 3 days before. | |
| E11 | A wallet that has never earned reports the full 90-day window, not a countdown. | `expiryDaysLeft` |
| E12 | "This month" summaries use the **calendar month** in the user's timezone, not a rolling 30 days. | `coinsStore.summarizeMonth` |
| E13 | `CoinSource` is a closed enum of seven: `steps, workout, streak, challenge, referral, purchase, refund`. Leaderboard payouts use `challenge`; streak restores debit as `streak` (negative), **not** `purchase`. | 🔒 fixes contradiction C6 |
| E15 | **Escrow.** Step coins are created as `coin_holds` (`pending`), shown as `pending` on the wallet, and released to the ledger by the `releaseHolds` job after the user's trust tier window (§T) if no new flag appeared; otherwise voided with a reason. Workouts, streaks, challenges, referrals and leaderboard credit directly. | |
| E16 | Nothing is spendable while pending. `balance` excludes `pending`. | |
| E14 | Earn rates ⚙ (all in `app_config.coins`): steps **`coinsPerUnit` per `unitSteps`** — default **0.095 per 100** (D-26); workout 100 (inherited, see D-32); streak per milestone table (7 d = 50); referral **20 / 20** both sides; challenge per definition; leaderboard 5,000 / 3,000 / 1,000. The rate card the wallet shows is served from `/wallet/earn-rules`, never hardcoded. | D-26, C1, C2 |

## §A · Activity and steps

| # | Rule | Source / note |
|---|---|---|
| A1 | A step is credited only if its sample is **trusted**: origin on the allowlist ⚙ and recording method automatic/active. Manual entries and `wasUserEntered` samples are stored as `unverified` and never mint. | |
| A2 | Attestation must pass (Play Integrity / App Attest) for a batch to be trusted. Failed attestation → whole batch `unverified`, account flagged. Permissive mode ⚙ in staging. | |
| A3 | The day boundary is the user's local midnight in the timezone reported **with the sample**. A day, once credited, is never re-bucketed. | `hydrationStore.today()`, `utils/date.todayIso()` |
| A4 | Step credit uses a per-day high-water mark: `owed = floor(min(verified, CAP)/1000) × RATE − steps_credited`. Credit only if `owed > 0`. Idempotent by `('steps','activity_day', local_day)`. | |
| A5 | Daily step credit cap ⚙: 30,000 steps (= 300 coins at 10/1,000). Above 45,000 → fraud flag. | |
| A6 | Cadence > 3.5 steps/s sustained over 60 s → sample rejected. | |
| A7 | Stride coherence: when both steps and distance exist for an interval, `distance/steps` outside 0.35–1.2 m → penalty. | |
| A8 | Timestamps: future (> 5 min ahead of server), overlapping the same source, or older than 7 days → rejected. | |
| A9 | Overlapping samples from two providers count once; the higher-trust source wins (Watch > phone > third-party app). | |
| A10 | Replaying a batch changes nothing: unique index `{ userId, provider, sampleId }` on `activity_samples`. | |
| A11 | Every daily figure returned to the client carries `verified` and `source`. Unverified steps are shown, not hidden. | 4.3 in BACKEND.md |
| A12 | Fraud scoring runs in **shadow mode** for ≥ 2 weeks of production data before any threshold gates a coin. | |
| A13 | Weekly view = 7 local days ending today, oldest first, with day labels derived client-side from dates. | `weeklySteps` shape |
| A14 | **L1 denylist beats allowlist.** Origins on the denylist ⚙ (known step-fabrication packages) are `rejected`; origins on the allowlist ⚙ are `trusted`; unknown origins are `unverified` — shown, never paid, never punished. | |
| A15 | **L3 cross-check.** The client submits the OS pedometer count for the same window. Ratio health-store ÷ pedometer outside 0.7–1.3 ⚙ → flag `pedometer_mismatch`; > 2.0 → hard `unverified` for the day. Missing pedometer (no permission) → no penalty, no bonus. | |
| A16 | **L4 motion signature.** Windows classified `shake` (dominant > 3 Hz ⚙ and high variance) or `vehicle`/`still` (< 1 Hz with steps present) subtract from the day's score; ≥ 40% of a day's step-bearing windows non-walk → hard `unverified`. Walking is 1.4–2.5 Hz. Features only; raw traces are never accepted. | |
| A17 | **L5 patterns.** Round totals (multiple of 1,000 on ≥ 3 of 7 days), identical totals on consecutive days, > 20% of steps 01:00–05:00 local, ≥ 20,000 steps within 24 h of install → flags, never hard rejects on their own. | |
| A18 | **L6 graph.** An `installId`, `vendorId`, attestation key or push token seen on ≥ 3 accounts flags all of them; correlated step patterns across an IP/ASN cluster flag the cluster. | |
| A19 | **L7 economic.** Redemption within 60 min of a first-ever credit, address reuse across ≥ 3 accounts, or a leaderboard score jump > 3σ week-over-week → flag and step-up requirement. | |
| A20 | Day score = weighted mean L0 25 · L1 20 · L2 20 · L3 15 · L4 10 · L5 5 · L6 5 ⚙. Any hard reject sets `verified=false` regardless. | |
| A21 | All layer weights, thresholds and lists are remote config; a change is dated in MEMORY.md §5. | |

## §T · Trust score and tiers

| # | Rule | Source / note |
|---|---|---|
| T1 | Trust score 0–100 per user = EWMA (α 0.3 ⚙) of daily plausibility − open-flag penalty (5 per open flag, max 30) + bonuses (paired wearable +5, email+phone verified +5, address on file +3, tenure ≥ 90 clean days +5), clamped. Recomputed after every rollup and nightly. | |
| T2 | Tiers ⚙: **trusted** ≥ 80 · **normal** 50–79 · **watch** 30–49 · **restricted** < 30 · **banned** admin-only. New accounts start **normal** at 60. | |
| T3 | Hold windows ⚙: trusted 24 h · normal 72 h · watch 7 d · restricted manual · banned none. | |
| T4 | Daily step caps ⚙ by tier: trusted/normal 30,000 · watch 15,000 · restricted 5,000 · banned 0. | |
| T5 | Watch and below: redemption requires step-up OTP. Restricted and below: no redemption, no referral or leaderboard payout, user notified with an appeal path. | |
| T6 | Tier moves down immediately on score; moves up only after 7 consecutive clean days ⚙ (no new flags). | |
| T7 | A confirmed fraud flag voids all open holds; a dismissed flag restores the score contribution it removed. | |
| T8 | Banned: balance frozen, ledger retained, devices revoked, referrals voided, leaderboard entries excluded. Reversible only by admin with audit. | |
| T9 | Shadow mode ⚙: when on, scores and tiers are computed and dashboarded but every hold uses the **normal** window and no tier restriction is enforced. On for ≥ 2 weeks of production data (D-05). | |

## §DV · Devices and versions

| # | Rule | Source / note |
|---|---|---|
| DV1 | Every authenticated request carries a registered `X-Vokve-Device-Id`; missing → `428 DEVICE_NOT_REGISTERED`. | |
| DV2 | `installId` is a client UUIDv4 generated once and kept in Keychain (iOS) / Keystore-backed storage (Android). `vendorId` is `DeviceInfo.getUniqueId()`. Attestation key id comes from App Attest / Play Integrity. All three are stored; the server `deviceId` is canonical. | |
| DV3 | Registration is idempotent by `{ userId, installId }` (unique index). A re-registration updates profile, app and push fields. | |
| DV4 | Device profile fields: brand, manufacturer, model, deviceName, osVersion, isEmulator, isTablet, totalMemoryMb, carrier, locale, timezone, screen, hasBiometrics; app: version, build, bundleId, firstVersion. | `react-native-device-info` |
| DV5 | App version + build are on every request and stored on every audit row, ledger row (`actor`), fraud flag and sample batch. | |
| DV6 | `app_releases.status`: `current`, `supported`, `deprecated` (warn), `blocked` (`426 UPGRADE_REQUIRED` + store link). `minVersion` per platform in `/config`. | |
| DV7 | Refresh tokens are bound to `deviceId`. A refresh presenting a token from another device revokes it and notifies the user. | |
| DV8 | Max active devices per account 5 ⚙; a device on ≥ 3 accounts ⚙ flags them all (L6). | |
| DV9 | Emulator, rooted/jailbroken, debug build, hooking framework, mock location or developer mode → `signals` recorded, L0 score reduced; emulator or failed attestation → batch `unverified`. | |
| DV10 | Users can list and revoke devices; revocation drops refresh tokens and push token and ends the device session. | |
| DV11 | Daily `version_stats` per platform/version: DAU, installs, crashes (from Crashlytics export). | |

## §O · OTP (phone and email)

| # | Rule | Source / note |
|---|---|---|
| O1 | Codes are 6 digits, cryptographically random, hashed at rest; TTL 5 min ⚙; 5 verify attempts then burned; resend cooldown 30 s ⚙; max 3 resends/hour and 10 sends/day per target ⚙; per-IP and per-device limits. Same rules on both channels. | `verificationChallengeSchema` |
| O2 | One `otp_challenges` collection with `channel` (`sms`/`email`) and `purpose` (`signup_phone, verify_email, login, reset_password, change_phone, change_email, step_up`). A code verifies only its own challenge and purpose. | |
| O3 | **Phone** OTP is the session gate: `verify-otp` for `signup_phone` creates the user, sets `phoneVerifiedAt`, issues tokens. | existing contract |
| O4 | **Email** OTP is created and sent automatically after O3 succeeds; `POST /auth/email/send-otp` resends; `verify-otp` sets `emailVerifiedAt`. | D-20 |
| O5 | `emailVerifiedAt` **and** `phoneVerifiedAt` are required before: `/shop/redeem`, referral payout, leaderboard payout, `reset_password` by email, address creation. Missing → `403 EMAIL_NOT_VERIFIED` / `PHONE_NOT_VERIFIED` with a user-readable message. | |
| O6 | A wrong code leaves the challenge alive (attempt counter +1). The client keeps the user on the screen. | `authStore.verifyOtp` |
| O7 | Changing email or phone requires OTP on the **new** target and clears the corresponding `…VerifiedAt` until verified. | |
| O8 | Step-up: `purpose:'step_up'` returns a `stepUpToken` valid 10 min ⚙ for one action. | |
| O9 | Never log codes; never return whether a target exists (forgot-password is always 200). | |

## §W · Workouts

| # | Rule | Source / note |
|---|---|---|
| W1 | A workout is identified by the client-generated `id`; `POST /workouts` is an upsert on it. | `workoutStore.finishWorkout` |
| W2 | `totalVolumeKg` = Σ over completed sets of `reps × weightKg`. Server recomputes; client value ignored. | `workoutStore.totalVolume` |
| W3 | Calories are estimated server-side from duration, exercise types, and user body mass. Client value ignored. | |
| W4 | A workout pays 100 coins ⚙ only if plausible: duration ≥ 10 min ⚙, ≥ 1 completed set, no set with `weightKg > 500` or `reps > 200`. Implausible workouts are saved, marked `plausible=false`, and pay nothing. | |
| W5 | Workout coin cap ⚙: 2 per local day. | |
| W6 | A plausible workout marks its `local_day(startedAt)` as an **earned** streak day. | Replaces the never-called `streakStore.completeToday` |
| W7 | Deleting a paid workout posts a `refund` row of −100 and, if no other earned event exists for that day, converts the streak day to a gap (re-evaluate streak). | |
| W8 | New sets inherit the previous set's reps and weight — a client behaviour; the server does not care. | `workoutStore.addSet` |

## §S · Streak

Ported from `src/stores/streakStore.ts`. The golden tests in `__tests__/streakStore.test.ts` are the acceptance suite.

| # | Rule | Source / note |
|---|---|---|
| S1 | A day counts if it is `earned` (plausible workout) or `protected` (frozen/restored). | `countingDays` |
| S2 | **Current streak** is the run ending today, or ending yesterday if today is not yet covered. A streak is not broken until the day it needed is over. | `currentStreakOf` |
| S3 | **Longest streak** is the longest run on record, with `start` and `end` dates; null when nothing is recorded. | `longestStreakOf` |
| S4 | A **freeze** protects today. It is refused — with no charge — if no freezes remain or today is already covered. | `freezeToday` |
| S5 | Freezes are granted by rule ⚙ (proposal: 1 on sign-up, +1 per 30-day streak, max held 3). | seed: `freezesAvailable: 1` |
| S6 | **Restore** bridges every day from the last run's end + 1 through yesterday with `restored` days, only if the last run ended within **7 days** ⚙ (`RESTORE_WINDOW_DAYS`). If the current streak is already > 0 there is nothing to restore. | `restoreGapOf` |
| S7 | Restore costs **50 coins** ⚙ (`STREAK_RESTORE_COST`). Debit and protection happen in one transaction; if either fails, neither happens. | Closes the client's two-step race |
| S8 | Milestones ⚙ 7/15/30/90/180 days pay 50/150/300/1,000/2,000 coins, **once each**, judged against **longest** streak. A user who hit 30 in March keeps the badge in April. | `STREAK_MILESTONES`, `achieved={longestStreak >= days}` |
| S9 | Do steps alone (no workout) count as an earned day? **Decision pending** (MEMORY.md D-07). Default: **no** — the client's model comment says "consecutive days with a completed workout". | `userSchema.streakDays` doc |
| S10 | Streak-at-risk notification fires at 19:00 local ⚙ if today is not covered, subject to quiet hours and the `activity` category. | |

## §C · Challenges and achievements

| # | Rule | Source / note |
|---|---|---|
| C1 | A challenge has one `metric` (`steps, calories, minutes, days, workouts`) and one `cadence` (`daily, weekly, monthly`). | 🔒 |
| C2 | `startsAt: null` means running; a date means upcoming. There is no separate status field. | `challengeSchema.startsAt` |
| C3 | Progress is recomputed server-side from **verified** activity for the current period; the client never sends progress. | |
| C4 | A claim succeeds once per `(user, challenge, period)` when `progress ≥ goal`; pays `rewardCoins` and, if `rewardsBadge`, an achievement. | |
| C5 | Enrolment: **auto-enrol every active user** in every open challenge (pending D-08). | |
| C6 | Daily challenges reset at local midnight; weekly on Monday 00:00 local; monthly on the 1st 00:00 local. | |
| C7 | Achievement `value` is a number; formatting ("10K") is the client's job. | fixes C8 |

## §L · Leaderboard

| # | Rule | Source / note |
|---|---|---|
| L1 | Period = Monday 00:00 → Sunday 23:59:59 in the **country's** primary timezone ⚙. | `LeaderboardHowItWorks` |
| L2 | Scope = user's `country` (ISO-3166-1 alpha-2), set at sign-up from phone dial code, editable once in profile; changes take effect next period. | pending D-09 |
| L3 | **Score formula** ⚙ (proposed, to resolve C5): `score = verified_steps / 100 + workouts × 50 + challenges_completed × 100`. A 70k-step week with 4 workouts and 3 challenges = 700 + 200 + 300 = 1,200. Tuned so no single source dominates. | |
| L4 | Only verified activity scores. | |
| L5 | Tie-break: higher score → earlier timestamp at which that score was reached → lower `user_id`. Two users never share a rank. | |
| L6 | At close, standings are **frozen** into `leaderboard_snapshots`; payouts and history read from the snapshot only. | |
| L7 | Tiers ⚙: rank 1 → 5,000 coins + Premium T-Shirt + Water Bottle; ranks 2–3 → 3,000 + T-Shirt + Fitness Mat; ranks 4–10 → 1,000 + Fitness Mat. | `REWARD_TIERS` |
| L8 | Merchandise perks create an order automatically (status `awaiting_address` if none on file). | |
| L9 | An account with an open fraud flag at close is excluded from payout and its rank is skipped (no re-ranking of others). | |
| L10 | "Rewards land on Monday" — payout job runs immediately after close. | |

## §R · Shop and orders

| # | Rule | Source / note |
|---|---|---|
| R1 | Prices are coins only. No cash path. | `shopItemSchema.priceCoins` |
| R2 | Redemption is one transaction: lock balance → lock inventory → check both → order + items → inventory − qty → ledger −price → balance. | |
| R3 | Insufficient funds → `422 INSUFFICIENT_COINS { required, balance }`. Out of stock → `409 OUT_OF_STOCK`. | Client shows "Need N more" |
| R4 | A shipping address is required at redemption and **snapshotted** into the order. | |
| R5 | Order states: `placed → confirmed → shipped → delivered`; `placed|confirmed → cancelled`; `delivered → refunded` (admin). Every transition is an `order_events` row. | |
| R6 | Cancel refunds the full price as a `refund` row and restores inventory. | |
| R7 | Order count shown in the shop = count of `orders`, not ledger rows with `source='purchase'`. | fixes the `ShopScreen` heuristic |
| R8 | `inStock` = `on_hand > 0`. Low-stock alert at `on_hand ≤ low_stock_at`. | |
| R9 | `isDeal` and `badge` are catalogue flags, not categories. `ShopCategory` is a closed enum of four. | 🔒 |

## §Y · Hydration

| # | Rule | Source / note |
|---|---|---|
| Y1 | An entry is `ml > 0`, integer, with a timestamp; its day is the local day of `at`. | `hydrationEntrySchema` |
| Y2 | Today's total = Σ entries for the local day. Yesterday's total never appears as today's. | `hydrationStore` rollover |
| Y3 | Goal default 2,500 ml; clamp 500–8,000. | `settingsStore` |
| Y4 | Stats: `bestStreakDays` = longest run of days with total ≥ goal; `dailyAverageMl` over the last 30 days with ≥ 1 entry; `goalHitRatePercent` = days ≥ goal / days with entries, last 30 days. | replaces `hydrationHighlights` |
| Y5 | Reminder schedule: `enabled`, list of `{ time HH:mm, slot, enabled }`, `sound`, `vibration`, `repeatDays ⊆ {0..6}` (0 = Monday, matching `REPEAT_DAYS`). Duplicate `(time, slot)` is a no-op. | `remindersStore` |
| Y6 | Reminders are sent only if `enabled`, the reminder is enabled, today ∈ `repeatDays`, the `health` category is on, and it is outside quiet hours. | |

## §N · Nutrition

| # | Rule | Source / note |
|---|---|---|
| N1 | Slots are exactly `breakfast, lunch, snack, dinner`, in that display order. | 🔒 `MEAL_ORDER` |
| N2 | An entry's day is the local day of `loggedAt`. Batch adds share one `loggedAt` built from the chosen date + time. | `nutritionStore.dateOf` |
| N3 | Entries with an empty name are rejected; calories rounded to integer, macros clamped ≥ 0. | `toEntry` |
| N4 | Goal defaults: 2,200 kcal / 120 P / 300 C / 70 F. Preferences defaults: vegetarian / balanced / gain_weight. | `DEFAULT_GOALS`, `DEFAULT_PREFERENCES` |
| N5 | Per-slot summary: item count, kcal, `startedAt` = earliest `loggedAt` in the slot, names. | `summariseMeals` |
| N6 | Diet plan for a date = generated meals for that date + user-added meals, sorted by time. User-added meals default to 08:00/13:00/17:00/20:00 by slot. | `dietPlanStore` |
| N7 | Plan generation ⚙ (proposal): pick from curated templates keyed by `(dietType, mealPlan)`, scale portions to the kcal goal, rotate so no day repeats within 7 days. | replaces `dietPlanRotation` |
| N8 | Custom foods are private to their creator. Global library items have `owner_user_id = null`. | |
| N9 | Nutrition logging mints **no coins** in v1. | |

## §V · Vitals and health

| # | Rule | Source / note |
|---|---|---|
| V1 | Kinds: `heart_rate` (bpm), `blood_pressure` (systolic = `value`, diastolic = `secondary`, mmHg), `weight` (kg). **`bmi` is never accepted as input** — it is derived. | 🔒 enum keeps `bmi` for output compatibility; fixes C9 |
| V2 | Bounds: HR 30–220; systolic 60–250; diastolic 30–150; weight 20–350 kg. Out of bounds → 422. | `AddReadingSheet.BOUNDS` |
| V3 | BMI = `weight_kg / (height_m)²`, from the latest weight reading and `User.heightCm`; null if either is missing. | |
| V4 | A `weight` reading updates `User.weightKg` and inserts a `body_measurements` row. One write path. | fixes C10 |
| V5 | Heart-rate bands: < 60 low · 60–100 normal · 101–120 elevated · > 120 high. | `HEART_BANDS` |
| V6 | Blood-pressure bands: **high** if systolic ≥ 130 **or** diastolic ≥ 80; else **low** if systolic < 90 or diastolic < 60; else **elevated** if systolic 120–129; else **normal**. Either half can raise the band. | `pressureBandFor` |
| V7 | BMI bands: < 18.5 underweight · 18.5–24.9 healthy · 25–29.9 overweight · ≥ 30 obese. | `BmiGuide` |
| V8 | **Health score** ⚙ (proposal, resolves C11): 0–100 = 30 × activity (7-day avg steps / goal, capped 1) + 20 × hydration (7-day goal-hit rate) + 20 × vitals (1 if latest HR and BP normal, 0.5 if elevated/low, 0 if high or missing) + 15 × BMI (1 if healthy, 0.5 if adjacent band, 0 otherwise) + 15 × consistency (current streak / 7, capped 1). Return the factor breakdown. | |
| V9 | All vitals responses carry a wellness disclaimer string; band copy never uses diagnostic language beyond what the client already shows. | |
| V10 | Vitals from HealthKit / Health Connect are accepted through the ingest path with `source = provider`; manual entries have `source = 'manual'`. | |

## §F · Referrals

| # | Rule | Source / note |
|---|---|---|
| F1 | Every user has one code, generated at sign-up: 6–8 uppercase alphanumerics, no ambiguous characters (0/O, 1/I). | seed `'VOKVE123'` |
| F2 | A code can be applied once per invitee, within 7 days of sign-up ⚙, never to oneself. | |
| F3 | Qualifying event ⚙ (pending C2): invitee's **first plausible workout**. Payout: 300 to inviter *or* 20 to each side. Status `pending` until then, `rewarded` after. | `HowReferralWorksCard`, `EarnCoinsCard` |
| F4 | Inviter cap ⚙: 10 rewarded referrals per calendar month. | |
| F5 | Device sharing between inviter and invitee, or an invitee whose attestation fails, voids the referral and flags both. | |
| F6 | Share message and URL come from the server so they can carry campaign parameters. | `shareMessageFor` is client-side today |

## §M · Messaging

| # | Rule | Source / note |
|---|---|---|
| M1 | Feed topics (9) map to feed filters (3): activity = steps/workout/streak/hydration; reward = coins/challenge/reward; system = health/system. | 🔒 `NOTIFICATION_CATEGORY` |
| M2 | Send categories (8) are consent: `activity, coins, challenges, orders, offers, announcements, referrals, health`. Defaults all on except `health`. | `notificationSettingsStore` |
| M3 | Topic → send category: steps/workout/streak → activity; coins → coins; challenge/reward → challenges (or offers for promotions); order events → orders; hydration/health → health; system → announcements; referral events → referrals. | |
| M4 | A category that is off suppresses push/SMS/email but the feed row is still written. | |
| M5 | Quiet hours (default 22:00–07:00 local, may cross midnight) defer non-exempt messages to window end. Exempt: OTP, password reset, order-security. | |
| M6 | SMS only for `orders` when `sms = true`. Email only when `email = true`. | |
| M7 | Filter-chip counts are **totals**, not unread. | `useNotificationCounts` |
| M8 | Feed rows older than 90 days are purged. | |

## §P · Profile and settings

| # | Rule | Source / note |
|---|---|---|
| P1 | `profileCompletedAt` is set only by `POST /me/complete-profile`, once. `PATCH /me` cannot set or clear it. | `RootNavigator` gate |
| P2 | Height 90–250 cm; weight 25–300 kg, stored to 0.1. | `isProfileWithinRange`, `round1` |
| P3 | Setting clamps: step goal 1,000–50,000; water 500–8,000 ml; rest timer 15–600 s. | `settingsStore` |
| P4 | Level ⚙ (proposal): level = `floor(sqrt(lifetime_earned / 100))`, tier titles every 5 levels ("Athlo Warrior" at 15–19 per seed). | `profileHighlights` |
| P5 | Deleting an account: anonymise `users` row (keep id for ledger integrity), delete health/nutrition/vitals data, revoke tokens, cancel open orders, void referrals. Ledger and orders are retained anonymised for accounting. | |

---

# Part B — Engineering rules

## §X · API contract

| # | Rule |
|---|---|
| X1 | The client's zod schemas are the contract. A response that fails them is a bug on the server. |
| X2 | **Additive only** within `/v1`. Never rename, remove, or retype a field; never add an enum member without a client release. Breaking change → `/v2`. |
| X3 | Absent nullable fields are sent as `null`, never omitted. |
| X4 | Timestamps: ISO-8601 with offset. Calendar days: `YYYY-MM-DD`. Times of day: `HH:mm`. Epoch ms only for `AuthTokens.expiresAt`. |
| X5 | Errors: `{ error: { code, message, details } }`. `code` is `SCREAMING_SNAKE`, stable, documented. `message` is user-readable and rendered verbatim. 422 for validation with `details` keyed by field. |
| X6 | Lists: `{ data, nextCursor }`, cursor opaque, `null` on the last page. |
| X7 | Every mutating endpoint honours `Idempotency-Key` for 24 h and behaves identically under 3 replays. |
| X8 | Every `:id` route checks ownership. A foreign id is `404`, not `403` (do not leak existence). |
| X9 | Numeric input is bounded server-side regardless of client clamps. |
| X10 | Every request logs `requestId, userId, platform, appVersion, deviceId, tz, route, status, ms`. Never log tokens, OTPs, passwords, or health values. |

## §D · Data and transactions

| # | Rule |
|---|---|
| D1 | Coin movements happen inside a MongoDB session transaction: conditional `findOneAndUpdate({ balance: { $gte: price } }, { $inc })` on `coin_balances` plus the ledger insert (and order/inventory writes for redeem). No coin write outside `economy.credit()` / `hold()` / `release()` / `debit()`. |
| D2 | `local_day` is computed once at write time from the event timestamp and the request's `X-Vokve-Timezone`, stored, and never recomputed. |
| D3 | Soft-delete user-created documents (`deletedAt`); hard-delete only via account deletion. |
| D8 | Every collection has declared indexes in `packages/db`; CI fails on drift between declared and deployed indexes. Unique indexes are the enforcement for idempotency — never application-level existence checks. |
| D9 | `$jsonSchema` validators generated from the shared zod schemas; hand-written validators for `balance ≥ 0`, `onHand ≥ 0`, `amount ≠ 0`. |
| D10 | Transactions are short (< 1 s, ≤ 10 documents) and never span external calls. |
| D11 | The application DB role has no `update`/`remove` privilege on `coin_ledger`, `activity_samples` or `audit_log`. |
| D4 | Raw `activity_samples` are immutable. |
| D5 | Every admin action writes `audit_log` with before/after. |
| D6 | Migrations are forward-only, reversible by a new migration, and run in CI against a copy of production schema. |
| D7 | `Mixed`/embedded documents only for pass-through structures (`workouts.exercises`, sample metadata, address snapshots); anything queried or constrained is a typed top-level field with an index. |

## §J · Jobs

| # | Rule |
|---|---|
| J1 | Every job is idempotent and safe to run twice concurrently. |
| J2 | Midnight-anchored jobs run hourly and select users whose local midnight just passed. |
| J3 | Jobs that mint coins go through `economy.credit()` like everything else — no bulk `INSERT` into the ledger. |
| J4 | A failed job retries with backoff (5 attempts) then dead-letters with an alert. |

## §Q · Quality gates

| # | Rule |
|---|---|
| Q1 | CI runs: typecheck, lint, unit, integration against a `mongodb-memory-server` **replica set** + Redis, contract tests against the client's schemas, index/validator drift check, migration dry-run. |
| Q2 | Release branches assert `bypassAuthInDev === false` and `useMockApi === false` in the client source. |
| Q3 | Ledger property tests and streak golden tests are required to pass for any PR touching `economy/` or `streak/`. |
| Q4 | A PR that adds an enum member or changes a response shape must link the client PR that consumes it. |
| Q5 | Fraud thresholds are changed via config with a dated note in MEMORY.md, never hardcoded. |

## §Z · Security

| # | Rule |
|---|---|
| Z1 | Access JWT ES256, 15 min. Refresh opaque, hashed at rest, 60 days, rotated on use, 30 s grace via `superseded_by`. |
| Z2 | Passwords Argon2id. OTPs hashed. Attestation raw verdicts stored, tokens not. |
| Z3 | Rate limits: `/auth/*` per IP + per target (phone/email) + per device; `/activity/ingest` per user + per device; `/devices/register` per IP; everything else per user. |
| Z4 | Health collections in their own database with a separate DB role; application role has no `update`/`remove` on `coin_ledger`, `activity_samples`, `audit_log`. |
| Z5 | Minimum app version enforced from `GET /config`; a rejected version gets `426 UPGRADE_REQUIRED`. |
| Z6 | Secrets via environment/secret manager; none in the repo. |
