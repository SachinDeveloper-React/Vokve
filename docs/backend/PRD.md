# VOKVE Backend — Product Requirements Document

**Version:** 1.1 · **Owner:** Backend · **Derived from:** client at `fdbc4b0` · **Datastore:** MongoDB
**Related:** [BACKEND.md](../BACKEND.md) (API spec) · [ARCHITECTURE.md](ARCHITECTURE.md) · [RULES.md](RULES.md) · [PHASES.md](PHASES.md) · [MEMORY.md](MEMORY.md)

---

## 1. Product summary

Vokve is a move-to-earn fitness app. Users walk, train, hydrate, eat and track vitals; the app pays **V-Coins** for verified activity; coins buy **physical goods** from an in-app shop, and weekly country leaderboards pay coins plus merchandise to the top ten.

Tagline on every auth screen: **Move • Earn • Achieve.** The three perks the sign-in screen promises — *Track Steps · Earn V-Coins · Redeem Rewards* — are the product's core loop, and the backend exists to make each of the three true and trustworthy.

The client is complete: 30 screens, every flow navigable. **The backend's job is to replace 1,190 lines of seed data and 13 device-local stores with a system of record that can pay out real merchandise without being defrauded.**

## 2. Goals

| # | Goal | Measure |
|---|---|---|
| G1 | The shipped client runs unchanged against a real API | `useMockApi: false` with zero client edits for the four existing contracts |
| G2 | Coins are impossible to mint or spend without a verified server event | No client-callable credit endpoint; ledger reconciles nightly with zero drift |
| G3 | Fake steps are identified before they are paid | Eight-layer detection (BACKEND §7.5); step coins escrowed by trust tier; ≥ 95% of released coins from automatic-recording provenance; fraud flag rate and void rate on a dashboard |
| G7 | Every request, coin and flag is attributable to a device and an app version | 100% of authenticated requests carry a registered `deviceId`; version adoption dashboard; fraud-by-build query |
| G8 | Both email and phone are OTP-verified before any coin leaves the account | `emailVerifiedAt` and `phoneVerifiedAt` required on redeem/payout paths |
| G4 | Every screen's data comes from the server, with the device as cache | `seedData.ts` deleted |
| G5 | Physical redemption is a real order pipeline | An order has an address, an inventory decrement, a ledger row and a fulfilment state |
| G6 | Health data handling passes App Store, Play, and privacy review | Consent per provider, deletion, export, encrypted at rest |

## 3. Non-goals (v1)

- Premium subscription / IAP (card exists, no design behind it)
- Social features beyond referral (no friends, feeds, comments)
- Live camera heart-rate measurement (the "Live Measure" card opens a manual log sheet)
- Wearable-specific integrations (they arrive through Health Connect / HealthKit)
- Web client or admin UI beyond what fulfilment and fraud review need
- Multi-currency / cash pricing in the shop (coins only)
- Nutrition AI / photo logging

## 4. Users and roles

| Role | Description |
|---|---|
| **Member** | App user. Owns their data. Earns and spends coins. |
| **Fulfilment operator** | Views placed orders, updates shipping state, marks delivered. |
| **Fraud reviewer** | Sees flagged accounts, sample histories, integrity verdicts; can freeze, claw back, unflag. |
| **Catalogue admin** | Manages shop items, inventory, challenges, reward tiers, earn rates, food library. |
| **System** | Scheduled jobs; the only minter of coins. |

Roles 2–4 need an internal admin surface (Phase 5). v1 can be a protected admin API plus a low-code UI (Retool/Forest/Directus-style) — do not hand-build an admin front-end first.

## 5. Functional requirements

Numbered for traceability to PHASES.md and to tests. **MUST** = launch-blocking. **SHOULD** = launch-desirable. **MAY** = later.

### FR-A · Identity and onboarding

| ID | Requirement |
|---|---|
| A1 | MUST support sign-up with email, E.164 phone, password, DOB, gender; email and phone unique. |
| A2 | MUST prove phone ownership with a 6-digit OTP before issuing any session. |
| A3 | MUST issue access + refresh tokens; refresh rotates; single-flight refresh tolerated. |
| A4 | MUST support sign-in with **either** email or phone in one identifier field. |
| A5 | MUST gate the app on `profileCompletedAt`; only complete-profile sets it. |
| A6 | MUST provide sign-out that revokes the refresh token. |
| A7 | MUST provide account deletion and data export. |
| A8 | SHOULD support Google, Apple, Facebook sign-in with server-side token verification. |
| A9 | SHOULD provide forgot/reset password via email or SMS. |
| A10 | MUST rate-limit OTP send and verify per target (phone or email), per IP, per device, on both channels. |
| A11 | MUST verify the user's **email by OTP** (6-digit code sent to the address) and record `emailVerifiedAt`. The challenge is created automatically after phone verification and can be resent. |
| A12 | MUST require both `phoneVerifiedAt` and `emailVerifiedAt` before any coin spend, referral payout, leaderboard payout, or email-based password reset. Phone remains the session gate (soft email gate — D-20). |
| A13 | MUST implement one polymorphic `verify-otp` for purposes `signup_phone, verify_email, login, reset_password, change_phone, change_email, step_up`; a code for one purpose never verifies another. |
| A14 | SHOULD support passwordless login by OTP on either channel. |
| A15 | SHOULD require step-up OTP before redemptions ≥ 1,000 coins ⚙, address changes and device revocation. |
| A16 | MUST bind refresh tokens to a device; a refresh from a different device revokes the token and notifies the user. |

### FR-P · Profile and settings

| ID | Requirement |
|---|---|
| P1 | MUST expose the `User` model exactly as the client's zod schema, plus `createdAt` and `country`. |
| P2 | MUST expose profile highlights: level, tier title, achievement count, lifetime steps. Level curve defined in RULES.md. |
| P3 | MUST sync user settings (units, step goal 1,000–50,000, water goal 500–8,000 ml, rest timer 15–600 s, haptics, reminders, keep-awake). |
| P4 | MUST sync notification preferences: 8 category switches, quiet hours, SMS, email. |
| P5 | MUST support avatar upload. |
| P6 | MUST support shipping addresses (create, list, update, delete, default). |

### FR-D · Devices and versions

| ID | Requirement |
|---|---|
| D1 | MUST issue every install a server `deviceId` via `POST /devices/register`, keyed by a client-generated `installId` (UUID in Keychain/Keystore) and linked to the OS `vendorId` and the attestation key id. |
| D2 | MUST collect device information at registration and on heartbeat: brand, manufacturer, model, device name, OS version, emulator/tablet flags, memory, carrier, locale, timezone, screen, push token. |
| D3 | MUST record app version, build number and bundle id per device and per request; every log, audit row and fraud flag carries `deviceId`, `appVersion`, `build`. |
| D4 | MUST reject authenticated requests without a registered `X-Vokve-Device-Id` (428) and requests from a blocked build (426 with store link). |
| D5 | MUST maintain `app_releases` (platform, version, build, status current/supported/deprecated/blocked) and serve `minVersion` in `/config`. |
| D6 | MUST materialise daily version adoption (DAU, installs) per platform/version. |
| D7 | MUST let users list their devices and revoke any one (sign out that device, drop its push token). |
| D8 | MUST detect device integrity signals (emulator, rooted/jailbroken, debug build, hooking framework, mock location, developer mode) and feed them to fraud layer L0. |
| D9 | MUST flag a device registered to ≥ 3 accounts and cap active devices per account at 5 ⚙. |
| D10 | SHOULD send a "new sign-in on <model>" notification on first registration of a device. |

### FR-S · Steps and activity

| ID | Requirement |
|---|---|
| S1 | MUST accept batched activity samples (steps, distance, active energy, active minutes) with per-sample provenance metadata and a device attestation token. |
| S2 | MUST reject or mark unverified any sample whose provenance is manual entry or an untrusted origin. |
| S3 | MUST verify Play Integrity (Android) and App Attest (iOS) on ingest. |
| S4 | MUST score daily rollups for plausibility and record the score. |
| S5 | MUST roll up per user per **local** day using the device's reported timezone. |
| S6 | MUST serve today, weekly (7 days), and arbitrary range at hour/day/week/month granularity. |
| S7 | MUST expose `verified` and `source` on every daily figure. |
| S8 | MUST be idempotent per sample; replaying a batch changes nothing. |
| S9 | MUST support per-provider connection state and sync cursor. |
| S10 | SHOULD ingest heart-rate and weight samples through the same path. |
| S11 | MAY accept manual step entry, never minting coins for it. |
| S12 | MUST run the eight fraud layers (L0 device integrity, L1 provenance with allow **and deny** lists, L2 statistics, L3 cross-source, L4 motion signature, L5 temporal/behavioural, L6 graph, L7 economic) on every daily rollup and record per-layer scores and flags. |
| S13 | MUST read the OS pedometer counter on the client for the same window and submit it as a cross-check source (L3). |
| S14 | MUST submit accelerometer **features** (dominant Hz, variance, zero-crossing rate, peak ratio) per 5-minute window while steps accrue — never raw traces (L4). |
| S15 | MUST maintain a per-user trust score (0–100, EWMA) and tier (trusted/normal/watch/restricted/banned), with tier-dependent daily step caps. |
| S16 | MUST escrow step coins in `coin_holds` and release them after the tier's window (24 h / 72 h / 7 d / manual) only if no new flag appeared; void otherwise. |
| S17 | MUST expose `pending` coins on the wallet and `verified`/`source` on daily figures so the user sees what is held and why. |
| S18 | MUST provide a fraud review queue with confirm/dismiss/void/clawback/ban/appeal actions, all audited. |
| S19 | MUST run L0–L7 in shadow mode for ≥ 2 weeks of production data before any layer gates a hold or release. |

### FR-W · Workouts

| ID | Requirement |
|---|---|
| W1 | MUST serve workout templates and an exercise library filterable by muscle group and equipment. |
| W2 | MUST save a completed workout idempotently by client-generated id. |
| W3 | MUST recompute total volume and calories server-side. |
| W4 | MUST write the streak day on a saved workout that meets plausibility minimums. |
| W5 | MUST page history with an opaque cursor. |
| W6 | SHOULD allow edit and delete; deletion of a paid workout posts a compensating ledger row. |

### FR-K · Streaks

| ID | Requirement |
|---|---|
| K1 | MUST compute current streak anchored on today or yesterday (a day is not missed until it is over). |
| K2 | MUST compute longest streak with start/end dates. |
| K3 | MUST distinguish earned days from protected (freeze/restore) days. |
| K4 | MUST grant and spend freezes; refuse without charge when none left or today is covered. |
| K5 | MUST restore a broken streak for 50 coins only when the last run ended within 7 days; debit and protection are atomic. |
| K6 | MUST pay milestones (7/15/30/90/180) once each, judged against **longest** streak. |
| K7 | MUST send a "streak at risk" notification in the evening (respecting quiet hours) when today is not yet covered. |

### FR-C · Coins

| ID | Requirement |
|---|---|
| C1 | MUST keep an append-only ledger; balance and lifetime earned are projections. |
| C2 | MUST mint coins only from server-verified events (steps, workout, streak, challenge, referral, leaderboard). No client credit endpoint. |
| C3 | MUST enforce a **hard per-user daily coin ceiling** (`coins.dailyCap`, default 300, configurable without deploy) across all sources, atomically in the same transaction as the credit, counting holds on the day earned; plus per-source caps and an optional monthly cap. Partial grants allowed; remainder dropped. Refunds and leaderboard payouts exempt. Wallet exposes `dailyCap / earnedToday / remainingToday`. |
| C4 | MUST enforce a unique constraint preventing the same event paying twice. |
| C5 | MUST debit inside a locked transaction; insufficient funds is a 422 with `required` and `balance`. |
| C6 | MUST expire idle balances after 90 days with 14-day and 3-day warnings. |
| C7 | MUST serve wallet summary (balance, lifetime, calendar-month earned/spent/net, expiry), paged ledger, and the earn-rate card. |
| C8 | MUST reconcile ledger vs balances nightly and alert on drift. |
| C9 | MUST support admin clawback via compensating rows with audit trail. |

### FR-H · Challenges and achievements

| ID | Requirement |
|---|---|
| H1 | MUST serve challenges by cadence (daily/weekly/monthly) with server-computed progress. |
| H2 | MUST split running vs upcoming purely on `startsAt` (null = running). |
| H3 | MUST pay a claim once, only when verified progress ≥ goal. |
| H4 | MUST award and list achievements with unlock timestamps. |
| H5 | SHOULD auto-enrol all users in open challenges (decision pending — MEMORY.md). |

### FR-L · Leaderboard and rewards

| ID | Requirement |
|---|---|
| L1 | MUST run weekly periods Monday–Sunday, scoped by country. |
| L2 | MUST score on verified steps + workouts + completed challenges by the formula in RULES.md §L. |
| L3 | MUST freeze a snapshot at period close and pay tiers from the snapshot. |
| L4 | MUST tie-break deterministically. |
| L5 | MUST expose the viewer's own rank/score/percentile on every board read. |
| L6 | MUST serve personal history: best rank + date, top-ten finishes, reward coins, rewards won. |
| L7 | MUST serve reward tiers from config, not code. |

### FR-R · Shop and orders

| ID | Requirement |
|---|---|
| R1 | MUST serve the catalogue with real stock state, category, deal and badge flags. |
| R2 | MUST redeem in one transaction: lock balance → check funds → decrement inventory → ledger row → order. |
| R3 | MUST require a shipping address on redemption. |
| R4 | MUST track order state: placed → confirmed → shipped → delivered / cancelled / refunded. |
| R5 | MUST allow cancellation while placed/confirmed, refunding coins and restoring stock. |
| R6 | MUST notify on every order state change (push; SMS if the user opted in). |
| R7 | SHOULD alert operators on low inventory. |

### FR-Y · Hydration

| ID | Requirement |
|---|---|
| Y1 | MUST log and delete drinks; serve today's total and entries. |
| Y2 | MUST roll over at local midnight. |
| Y3 | MUST serve stats: best streak of goal-hit days, daily average, goal hit rate, reminder count. |
| Y4 | MUST store the reminder schedule (enabled, per-slot times, custom times, sound, vibration, repeat days). |
| Y5 | SHOULD deliver reminders server-side when the `health` category is on, respecting quiet hours. |

### FR-N · Nutrition

| ID | Requirement |
|---|---|
| N1 | MUST log food entries in batch with slot, macros, fibre and timestamp; delete by id. |
| N2 | MUST serve a day (entries, totals, per-slot summaries) and a range of day totals. |
| N3 | MUST store goals (kcal, protein, carbs, fats) and preferences (diet type, meal plan, goal). |
| N4 | MUST provide searchable food library and user-private custom foods. |
| N5 | MUST serve a diet plan per date with per-meal items and macros, and allow user-added planned meals. |
| N6 | SHOULD generate plans from preferences (diet type × meal plan × goal × kcal target). |
| N7 | MAY compute goal defaults from profile (Mifflin-St Jeor × activity level × goal offset). |

### FR-V · Vitals and health

| ID | Requirement |
|---|---|
| V1 | MUST log and list heart rate, blood pressure (systolic + diastolic), and weight readings with server-side bounds. |
| V2 | MUST derive BMI from latest weight and profile height; never accept it as input. |
| V3 | MUST update `User.weightKg` when a weight reading is logged. |
| V4 | MUST classify readings into bands (RULES.md §V) and return the band. |
| V5 | MUST compute a health score 0–100 with an explainable factor breakdown and a wellness disclaimer. |

### FR-F · Referrals

| ID | Requirement |
|---|---|
| F1 | MUST issue each user a unique code and share URL. |
| F2 | MUST accept a code at or shortly after sign-up, once per invitee. |
| F3 | MUST pay only when the invitee reaches the qualifying event (verified first workout — pending C2). |
| F4 | MUST list referrals with status pending/rewarded and stats. |
| F5 | MUST detect self-referral and device-sharing rings; cap payouts per inviter per month. |

### FR-M · Notifications

| ID | Requirement |
|---|---|
| M1 | MUST maintain a per-user feed with topic, title, message, read state. |
| M2 | MUST serve the feed filtered by category with per-category totals. |
| M3 | MUST register and revoke push tokens per device. |
| M4 | MUST honour category switches and quiet hours before sending push, SMS, or email; OTP and order-security messages are exempt from quiet hours. |
| M5 | MUST deliver push via FCM (Android) and APNs (iOS, via FCM). |

### FR-ADV · Advanced features

| ID | Requirement |
|---|---|
| ADV1 | SHOULD provide `POST /sync` — one round-trip offline sync for hydration, food and vitals with per-collection cursors, `clientId` upsert and last-write-wins by `updatedAt`. |
| ADV2 | MUST accept batched product-analytics events (`POST /events`) with device and version attached server-side; export nightly. |
| ADV3 | MUST serve remote config with feature flags, percentage rollouts and cohorts (tier, country, version); every ⚙ value lives there. |
| ADV4 | SHOULD support push campaigns to a segment with per-category consent and quiet hours. |
| ADV5 | SHOULD send a weekly insights digest (steps, health score trend, streak, nutrition). |
| ADV6 | SHOULD provide referral deep links (`vokve.app/r/CODE`) with deferred attribution on first device registration. |
| ADV7 | MUST enforce KYC-lite before physical shipping: verified email + phone + address + trust ≥ normal (+ step-up above threshold). |
| ADV8 | MUST provide an admin API: user 360 (devices, ledger, holds, flags, orders, samples), order ops, config editor, fraud queue, read-only impersonation. |
| ADV9 | MUST automate data lifecycle: per-collection retention, export bundles, deletion with legal hold. |
| ADV10 | MAY stream wallet/leaderboard updates over SSE. |
| ADV11 | MAY offer streak insurance (auto-freeze) as the first premium capability. |

### FR-X · Platform

| ID | Requirement |
|---|---|
| X1 | MUST serve remote config: earn rates, caps, milestones, reward tiers, feature flags, minimum app version, maintenance flag. |
| X2 | MUST expose a public liveness endpoint. |
| X3 | MUST accept and store `X-Vokve-Device-Id`, `-Platform`, `-App-Version`, `-Build`, `-OS-Version`, `-Timezone`, `-Locale` on every request. |

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| **Availability** | 99.9% monthly for read paths; ingest may degrade to queued-accept. |
| **Latency** | `GET /me` p95 < 100 ms; any list p95 < 300 ms; ingest ack p95 < 500 ms. |
| **Consistency** | Coin operations strongly consistent: MongoDB replica-set transactions, atomic conditional `$inc` on balances, unique ledger index. Leaderboards eventually consistent (≤ 15 min). Holds released within 15 min of their window. |
| **Idempotency** | Every mutating endpoint safe under 3 identical calls. |
| **Scale target v1** | 100k MAU, 20k DAU, 5 ingest batches/user/day → ~100k ingest/day; ~2M samples/day. |
| **Data retention** | Ledger and orders: indefinite. Raw samples: TBD (§12 of BACKEND.md). Notifications: 90 days. |
| **Security** | See BACKEND.md §10. |
| **Observability** | Structured logs, traces on every request, metrics on mint/spend/ingest/fraud, alerting on reconciliation drift. |
| **Compliance** | GDPR, India DPDP, Apple HealthKit terms, Health Connect policy, Play/App Store account-deletion rules. |
| **Localisation** | User-facing `message` strings are English v1; structure so they can be keyed later. Timezone-correct everywhere. |

## 7. Success metrics (first 90 days post-launch)

- Client runs against production API with `seedData.ts` deleted.
- Ledger reconciliation drift: **0 coins** across all users, every night.
- Fraud: < 2% of daily step credits reversed by clawback after week 4.
- Ingest coverage: ≥ 80% of DAU with a Health Connect/HealthKit connection.
- Redemption: 100% of orders have an address, a ledger row and a fulfilment state; 0 oversold items.
- Support: < 1% of MAU raising "my steps weren't counted" tickets (drives the `verified` UI honesty requirement).

## 8. Dependencies and assumptions

- **SMS provider** for OTP (India-first user base per seed data → MSG91 / Twilio with DLT registration).
- **Push**: Firebase Cloud Messaging (packages already installed client-side).
- **Attestation**: Google Play Integrity API; Apple App Attest / DeviceCheck.
- **Datastore**: MongoDB Atlas (replica set — required for transactions); Redis for live leaderboards, rate limits and idempotency locks.
- **Device info**: `react-native-device-info` (installed, unused) for the device profile, vendor id and emulator flag; client-generated `installId` in Keychain/Keystore.
- **Email**: transactional email provider for OTP (Resend / SES).
- **Object storage** for avatars, product images, exports.
- **Fulfilment partner** for physical goods (unknown — §12 Q6).
- **Food database**: seed list of ~20 Indian staples exists; licensing a fuller DB is a product decision (§12 Q11).
- Client will add four request headers and accept the additive schema changes listed in BACKEND.md §4.3.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Step fraud drains merchandise budget | High | Caps first, detection second; escrow bounds exposure to one tier window; observe-only phase before minting |
| Motion sampling (L4) hurts battery / privacy perception | Medium | 10 s per 5 min only while steps accrue; features only, never traces; opt-out reduces trust tier, not access |
| Email OTP adds sign-up friction | Medium | Soft gate: session after phone; email required only before money moves |
| Coin rate uneconomic at scale | High | Rates in remote config; model cost/MAU before Phase 3 |
| HealthKit review rejection | Medium | Entitlement + usage strings + review note; Android-first launch |
| SMS abuse / cost | Medium | Per-number/IP/device limits, resend cooldowns |
| Enum drift breaks installed clients | Medium | Closed-enum rule in RULES.md; additive-only policy; `/v2` on break |
| Timezone bugs around midnight | Medium | Local-day everywhere; never re-bucket a paid day |
| Contradictions (C1–C12) unresolved at launch | Medium | Tracked in MEMORY.md; Phase 3 gate |
