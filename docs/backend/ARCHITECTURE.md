# VOKVE Backend — Architecture

**Version:** 2.0 (MongoDB) · **Related:** [BACKEND.md](../BACKEND.md) · [PRD.md](PRD.md) · [RULES.md](RULES.md) · [PHASES.md](PHASES.md) · [MEMORY.md](MEMORY.md)

---

## 1. Principles

1. **Server is the system of record; device is a cache.** Every zustand store becomes a read-through cache with an offline write queue where the user creates data (hydration, food, vitals, workouts) and read-only where they do not (coins, streak, leaderboard).
2. **Coins move only inside a MongoDB transaction, only from a verified event, and only through the ledger.** No service, job or admin tool edits a balance directly.
3. **Share the contract with the client.** The client's zod schemas are the API contract; the server imports them for request/response validation and generates `$jsonSchema` validators from them for the collections.
4. **Local day is the unit of time for the product.** Streaks, hydration, nutrition, step credit and challenges roll at the user's local midnight.
5. **Idempotent everything.** Retries are guaranteed by the client; jobs re-run; batches replay. Unique indexes are the enforcement, not application checks.
6. **Every request is attributed to a device.** Device id, app version, build, OS and platform are on every request and every audit row. Fraud, support and analytics all start from the device.
7. **Observe before you enforce.** Fraud scoring runs in shadow mode for weeks before it gates a coin; trust tiers then scale how much is held back, never whether steps are shown.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript (Node 22 LTS)** | Import the client's zod schemas verbatim |
| HTTP | **Fastify 5** + `fastify-type-provider-zod` (Express acceptable) | Schema-first, OpenAPI from zod |
| Database | **MongoDB 7 (Atlas)**, replica set | Multi-document transactions for the ledger; unique compound indexes for idempotency; TTL indexes; `$setWindowFields` for ranks; time-series collections for analytics copies; Atlas Search for foods |
| ODM | **Mongoose 8** with TypeScript | Schema + validators + middleware; `$jsonSchema` generated from zod via `zod-to-json-schema` for DB-level enforcement |
| Cache / locks / limits | **Redis 7** | Live leaderboard ZSETs, rate limits, idempotency locks, OTP counters. *Mongo-only alternative:* `$setWindowFields` for ranks and a `locks` collection with TTL — workable at v1 scale |
| Jobs | **BullMQ** (Redis) — or **Agenda** (Mongo-backed) for a single-datastore deployment | Repeatable cron jobs, retries, dead-letter |
| Object storage | S3-compatible (AWS S3 / Cloudflare R2) | Avatars, product images, exports |
| Push | Firebase Cloud Messaging | Client packages installed; handles APNs |
| SMS / Email | MSG91 (India, DLT) + Twilio fallback / Resend or SES | OTP on both channels; opted-in order updates |
| Attestation | Google Play Integrity API; Apple App Attest + DeviceCheck | Verified server-side on ingest and on new-device registration |
| Device info | `react-native-device-info@15` (already installed, unused) | Model, OS, emulator flag, vendor id, app version/build |
| Tokens | JWT (ES256) access · opaque rotated refresh in DB, bound to a device | Stateless checks; per-device revocation |
| Observability | OpenTelemetry → Grafana/Tempo/Loki (or Datadog) · Sentry · Atlas Performance Advisor | |
| Infra | Docker · Terraform · one region · Atlas M10+ (M30 for prod) · managed Redis | Boring on purpose |
| CI | typecheck, lint, unit, integration against `mongodb-memory-server` **replica set** (transactions need it) + Redis, index/validator drift check, release-flag assertion | |

**Why MongoDB works for the ledger:** the two properties the coin economy needs are (a) *one event pays once* and (b) *balance never goes negative under concurrency*. (a) is a unique compound index on `coin_ledger` — a duplicate insert throws `E11000` and the credit is idempotent by construction. (b) is `findOneAndUpdate({ _id, balance: { $gte: price } }, { $inc: { balance: -price } })` — an atomic conditional single-document update that fails cleanly when funds are short. Wrapping both in a session transaction with the order and inventory writes gives all-or-nothing. No row locks needed.

**Where to be careful:** transactions need a replica set (Atlas provides one; local dev uses `mongodb-memory-server` in replset mode); keep transactions short (< 1 s, few documents); time-series collections do not support unique indexes, so raw samples live in a regular collection and the time-series copy is analytics-only.

## 3. Service decomposition

A **modular monolith** — one deployable, one database, module boundaries enforced by package structure.

```
apps/api                      Fastify app: routes → module services
apps/worker                   BullMQ/Agenda workers
apps/admin-api                Admin routes (separate deployable, same core)
packages/contracts            zod schemas shared with the client
packages/db                   Mongoose models, indexes, $jsonSchema validators, migration scripts
packages/core                 Domain modules — no HTTP knowledge

core/
  identity/      auth, sessions, otp (sms + email), social, profile, settings, deletion, export
  devices/       registration, fingerprint, versions, sessions per device, revocation, trust signals
  activity/      ingest, provenance, plausibility, motion features, rollups, ranges
  training/      templates, exercises, workouts
  streak/        day evaluation, freeze, restore, milestones
  economy/       ledger, balances, escrow, earn rules, caps, expiry, reconciliation
  engagement/    challenges, achievements, leaderboard
  commerce/      catalogue, inventory, orders, addresses, fulfilment
  wellness/      hydration, reminders, nutrition, foods, diet plans, vitals, health score
  social/        referrals, deep-link attribution
  messaging/     feed, preferences, push, sms, email, quiet hours, campaigns
  platform/      config, flags, cohorts, content, health, events
  integrity/     attestation, fraud layers, trust score, review queue, audit log
```

**Rule:** `economy` exposes `credit(event)`, `hold(event)` (escrow), `release(holdId)`, `debit(intent)` — all transactional, all idempotent by `(userId, source, referenceType, referenceId)`. Nothing else writes `coin_ledger` or `coin_balances`.

## 4. Request lifecycle

```
Client ──► Edge (TLS, WAF, IP rate limit) ──► Fastify
   │  Authorization: Bearer <jwt>
   │  Idempotency-Key
   │  X-Vokve-Device-Id, -Platform, -App-Version, -Build, -OS-Version, -Timezone, -Locale
   ▼
plugins:
  requestId → otel span
  → auth: verify ES256 JWT; load user ctx
  → device: require X-Vokve-Device-Id; upsert devices.lastSeenAt/app/os (debounced 5 min via Redis);
            reject 428 DEVICE_NOT_REGISTERED if unknown for this user; attach device ctx (trust tier)
  → version gate: compare X-Vokve-App-Version/Build to app_releases → 426 UPGRADE_REQUIRED if blocked
  → per-user + per-device rate limit (Redis)
  → idempotency: (userId, key) → replay stored | short lock
  → zod validate body/query → handler → zod validate response
  → idempotency store (TTL 24 h) → error mapper → structured log (with deviceId, version)
```

- **Device binding:** refresh tokens carry `deviceId`; a refresh from a different device id is refused and the token revoked (session theft signal).
- **New device:** first request from an unseen `deviceId` for a user must be `POST /devices/register` (with attestation). A registration from a device already bound to ≥ 3 other accounts is flagged.
- **Errors** always `{ error: { code, message, details } }`.

## 5. Data flows

### 5.1 Device registration and version tracking

```
app launch
  ├─ installId: read Keychain/Keystore; if absent generate UUIDv4 and store  (survives reinstall on iOS)
  ├─ vendorId:  DeviceInfo.getUniqueId()       (iOS identifierForVendor / Android ANDROID_ID)
  ├─ profile:   brand, manufacturer, model, deviceName, systemVersion, isEmulator, isTablet,
  │             totalMemory, carrier, locale, timezone, screen, appVersion, buildNumber, bundleId
  ├─ integrity: Play Integrity token / App Attest key + assertion
  └─ POST /devices/register { installId, vendorId, profile, integrity, pushToken? }
        server: upsert devices by (userId, installId); link vendorId; verify attestation;
                compute device trust signals (emulator, rooted, debug, attestation verdict);
                record app_releases usage; return { deviceId (server _id), trustTier, mustUpgrade }
every request: X-Vokve-Device-Id = server deviceId; lastSeenAt/app/os upserted (debounced)
```

Three ids, on purpose: **`installId`** (ours, stable per install, the canonical `X-Vokve-Device-Id` source), **`vendorId`** (OS-scoped, survives our reinstall on Android, correlates re-installs), **attestation key id** (App Attest `keyId` / Play Integrity `deviceRecognitionVerdict`) — the only one a cheater cannot mint. Device-sharing detection joins on all three.

### 5.2 Email + phone OTP

```
POST /auth/sign-up ─► otp_challenges { channel:'sms', purpose:'signup_phone', target: phone, payload: signup }
POST /auth/verify-otp ─► phone proven → users insert (phoneVerifiedAt) → tokens (session)
                      ─► auto-enqueue otp_challenges { channel:'email', purpose:'verify_email', target: email }
                         and send code to email
POST /auth/email/send-otp (auth'd; resend) ─► new challenge
POST /auth/verify-otp { verificationId, code } ─► emailVerifiedAt set → AuthResponse (same shape)
Gate: emailVerifiedAt required before /shop/redeem, referral payout, leaderboard payout,
      password reset by email (RULES O-series). Phone remains the session gate (D-20).
```
One `otp_challenges` collection, one `verify-otp` endpoint, polymorphic on `purpose`. Also used by: `login_otp` (passwordless), `reset_password`, `change_phone`, `change_email`, `step_up` (re-auth before redeem).

### 5.3 Steps → verification → escrow → coins

```
[device]
  Health Connect / HealthKit read since cursor (+ metadata)
  OS pedometer counter (CMPedometer / STEP_COUNTER) for the same window     ← cross-check source
  motion features per 5-min window (dominant Hz, variance, zero-crossings) ← never raw traces
  attestation token
  ▼
POST /activity/ingest
  1 integrity.verifyAttestation(device)                → batchTrust
  2 activity.dedupe  (unique index userId+provider+sampleId → E11000 = already have it)
  3 activity.provenance (origin allowlist/denylist, recordingMethod, wasUserEntered)
  4 insert activity_samples (raw, immutable)
  5 enqueue rollup(user, localDay)  [debounced 60 s]

worker rollup(user, day)
  6 aggregate samples → steps / verifiedSteps / distance / energy / minutes / hourly
  7 integrity.scoreDay(user, day): L0–L7 layers → plausibility 0–100, flags[]
  8 activity_daily upsert (incl. flags, plausibility, trustTierAtScore)
  9 integrity.updateTrust(user) → EWMA trust score → tier
 10 economy.hold({ source:'steps', ref:('activity_day', day), amount: owed(tier-capped) })
       → coin_holds (pending) ; wallet shows pendingCoins
 11 release job: after tier's hold window (24 h trusted / 72 h normal / manual if restricted)
       and no new red flags → economy.release(hold) → coin_ledger credit
 12 engagement.recompute(user); streak.evaluate(user, day) if D-07 says steps count
```

### 5.4 Workout → coins + streak

```
POST /workouts (idempotent by workout.id)
  training.validate (≥10 min, ≥1 completed set, sane loads) → plausible
  recompute totalVolumeKg, caloriesBurned
  workouts upsert
  economy.credit({ source:'workout', ref:('workout', id), amount:100, dailyCap:2 })   ← direct, no escrow
  streak.markEarned(user, localDay(startedAt)) → checkMilestones → economy.credit
  social.checkReferralQualification(user)
  engagement.recompute(user); messaging.enqueue('workout')
```

### 5.5 Redeem (one transaction)

```
session.withTransaction(async () => {
  bal = coin_balances.findOneAndUpdate(
          { _id: userId, balance: { $gte: price } },
          { $inc: { balance: -price }, $set: { updatedAt } }, { session, returnDocument:'after' })
  if (!bal) throw INSUFFICIENT_COINS(required, balance)
  inv = shop_inventory.findOneAndUpdate(
          { _id: itemId, onHand: { $gte: qty } }, { $inc: { onHand: -qty } }, { session })
  if (!inv) throw OUT_OF_STOCK
  order = orders.insertOne({ status:'placed', addressSnapshot, items, totalCoins }, { session })
  coin_ledger.insertOne({ userId, amount:-price, source:'purchase',
                          referenceType:'order', referenceId: order._id, idempotencyKey }, { session })
  audit_log.insertOne(...)
})
→ messaging.enqueue('reward', + SMS if opted in)
```
Preconditions checked before the transaction: `emailVerifiedAt`, `phoneVerifiedAt`, address on file, trust tier ≥ Normal, no open fraud hold.

### 5.6 Leaderboard week

```
every 15 min: engagement.rescore(period) → Redis ZADD lb:{period}:{country}
              (Mongo-only: leaderboard_scores upsert; rank via $setWindowFields { $rank })
Monday 00:00 (per country tz):
  close(period): materialise ranks → leaderboard_snapshots (deterministic tie-break)
  pay: rank 1..10 → economy.credit(source:'challenge', ref:('leaderboard', period+rank))
       + auto-orders for merch perks; skip accounts with open fraud flags (rank kept, no re-rank)
  notify; open next period
```

### 5.7 Notification dispatch

```
messaging.enqueue({ user, topic, title, message })
worker:
  prefs = notification_preferences(user); category = CATEGORY_OF[topic]
  if !prefs.categories[category] → feed row only
  if quiet && inWindow(now, tz) && !exempt(topic) → delay to window end
  push → every devices[].push.token (FCM); SMS if prefs.sms && category=='orders'; email if prefs.email
  notifications.insertOne(feed row)
```

### 5.8 Offline sync (advanced)

```
POST /sync { since: { hydration: cursor, food: cursor, vitals: cursor }, changes: { hydration:[...], food:[...], vitals:[...] } }
  → apply client changes (upsert by clientId, LWW by updatedAt, idempotent)
  → return server changes since each cursor + new cursors
```
One round-trip replaces per-collection polling for user-created data.

## 6. Collections

Field types are Mongoose-style. Every collection has `createdAt` / `updatedAt` (timestamps) unless noted. `_id` is `ObjectId` unless stated. Indexes are the contract — the CI "index drift" check compares them to what is deployed.

```js
// ───────────── identity ─────────────
users {
  _id, email: String (citext via collation), phone: String,          // both unique
  passwordHash, name, avatarUrl, heightCm, weightKg, dateOfBirth: Date, gender,
  goal, activityLevel, units, weeklyGoalWorkouts,
  country: String(2), timezone,
  phoneVerifiedAt: Date, emailVerifiedAt: Date, profileCompletedAt: Date,
  trust: { score: Number, tier: 'trusted'|'normal'|'watch'|'restricted'|'banned', updatedAt },
  flags: { frozen: Boolean, legalHold: Boolean },
  deletedAt
}
idx: { email:1 } unique collation{strength:2} · { phone:1 } unique sparse · { country:1 } · { 'trust.tier':1 }

auth_identities { _id, userId, provider: 'google'|'apple'|'facebook', subject }        idx: {provider,subject} unique
refresh_tokens  { _id, userId, deviceId, tokenHash, expiresAt, supersededBy, revokedAt } idx: {tokenHash} unique · {userId,deviceId} · TTL{expiresAt}
otp_challenges  { _id, userId?, channel:'sms'|'email', purpose, target, codeHash, attempts, resends,
                  expiresAt, resendAfter, consumedAt, payload: Mixed, deviceId, ip }
                idx: {target,purpose,createdAt:-1} · TTL{expiresAt, expireAfterSeconds: 3600}
user_settings   { _id: userId, dailyStepGoal, dailyWaterGoalMl, restTimerSeconds, hapticsEnabled, workoutRemindersEnabled, keepAwakeDuringWorkout }
notification_preferences { _id: userId, categories: {activity,coins,challenges,orders,offers,announcements,referrals,health}, quietHours:{enabled,start,end}, sms, email }
addresses       { _id, userId, label, name, phone, line1, line2, city, state, postalCode, country, isDefault, deletedAt }  idx: {userId,isDefault}

// ───────────── devices & versions ─────────────
devices {
  _id,                                  // server device id → X-Vokve-Device-Id
  userId, installId: String,            // client UUID in Keychain/Keystore
  vendorId: String,                     // identifierForVendor / ANDROID_ID
  platform: 'ios'|'android',
  info: { brand, manufacturer, model, deviceName, osVersion, isEmulator, isTablet, totalMemoryMb,
          carrier, locale, timezone, screen:{w,h,scale}, hasBiometrics },
  app:  { version, build, bundleId, firstVersion, updatedAt },
  push: { token, provider:'fcm', updatedAt, invalidAt },
  integrity: { provider:'play_integrity'|'app_attest', keyId, verdict, checkedAt, raw: Mixed },
  signals: { rooted, emulator, debugBuild, hookingFramework, mockLocation, developerMode },
  trust: { score, tier },
  firstSeenAt, lastSeenAt, revokedAt
}
idx: {userId,installId} unique · {installId} · {vendorId} · {'integrity.keyId'} · {'push.token'} · {lastSeenAt:-1} · {'app.version',platform}
device_sessions { _id, deviceId, userId, startedAt, endedAt, appVersion, ip, country }   idx: {userId,startedAt:-1} · TTL 180d
app_releases    { _id, platform, version, build, status:'current'|'supported'|'deprecated'|'blocked', minOs, releasedAt, notes }
                idx: {platform,version,build} unique
version_stats   { _id:{platform,version,day}, dau, installs, crashes }        // materialised daily

// ───────────── integrity ─────────────
attestations    { _id, userId, deviceId, provider, verdict, details: Mixed, checkedAt }  TTL 90d
fraud_flags     { _id, userId, deviceId, layer:'L0'..'L7', kind, severity:1-5, evidence: Mixed, day, status:'open'|'confirmed'|'dismissed', reviewedBy, reviewedAt }
                idx: {userId,status} · {status,severity:-1,createdAt:-1} · {userId,layer,kind,day} unique
trust_history   { _id, userId, day, score, tier, inputs: Mixed }             idx: {userId,day} unique
review_queue    { _id, userId, reason, priority, assignedTo, status, resolution, openedAt, closedAt }
idempotency_keys{ _id:{userId,key}, status, body: Mixed, createdAt }        TTL 24h
audit_log       { _id, actorType, actorId, deviceId, action, subjectType, subjectId, before: Mixed, after: Mixed, at }  idx: {subjectType,subjectId,at:-1}

// ───────────── activity ─────────────
health_connections { _id:{userId,provider}, grantedScopes:[String], syncCursor: Date, connectedAt, revokedAt }
activity_samples {
  _id, userId, provider:'health_connect'|'healthkit'|'pedometer'|'manual', sampleId,
  type:'steps'|'distance'|'active_energy'|'active_minutes'|'heart_rate'|'weight',
  value, startedAt, endedAt, localDay: String('YYYY-MM-DD'), tz,
  origin, recordingMethod, wasUserEntered, device: Mixed,
  provenance:'trusted'|'unverified'|'rejected', rejectionReason, batchId, deviceId, receivedAt
}
idx: {userId,provider,sampleId} unique · {userId,localDay,type} · {batchId} · {receivedAt}   (immutable; no updates)
activity_samples_ts (time-series, metaField:{userId,provider,type}, granularity:'minutes')  // analytics copy, optional
motion_windows  { _id, userId, deviceId, localDay, windowStart, features:{dominantHz, variance, zeroCrossRate, meanMag, peakRatio}, classifier:'walk'|'run'|'shake'|'vehicle'|'still', confidence }
                idx: {userId,localDay}
activity_daily {
  _id:{userId,localDay}, steps, verifiedSteps, pedometerSteps, distanceKm, activeMinutes, caloriesBurned,
  workoutsCompleted, hourly:[24 ints], source, verified: Boolean, plausibility, flags:[String],
  stepsCredited, stepsHeld, trustTierAtScore, updatedAt
}
idx: {'_id.userId':1,'_id.localDay':-1}

// ───────────── training ─────────────
exercises          { _id: String, name, muscleGroup, equipment, isTimed, imageUrl }
workout_templates  { _id: String, title, description, estimatedMinutes, muscleGroups:[], exerciseIds:[], sort }
workouts { _id: String (client id), userId, title, startedAt, completedAt, localDay, exercises: Mixed,
           totalVolumeKg, caloriesBurned, plausible, deviceId, deletedAt }     idx: {userId,startedAt:-1}
body_measurements  { _id, userId, recordedAt, weightKg, bodyFatPercent }        idx: {userId,recordedAt:-1}

// ───────────── streak ─────────────
streak_days       { _id:{userId,localDay}, kind:'earned'|'frozen'|'restored', sourceType, sourceId }
streak_freezes    { _id, userId, delta, reason }
streak_milestones { _id:{userId,days}, paidAt }

// ───────────── economy ─────────────
coin_ledger {
  _id, userId, amount: Int (≠0), source:'steps'|'workout'|'streak'|'challenge'|'referral'|'purchase'|'refund',
  title, referenceType, referenceId, idempotencyKey, actor, holdId, createdAt
}
idx: {userId,source,referenceType,referenceId} unique · {userId,createdAt:-1} · {idempotencyKey} unique sparse
coin_balances  { _id: userId, balance: Int (≥0, validator), pending: Int, lifetimeEarned: Int, lastCreditAt, updatedAt }
coin_holds     { _id, userId, amount, source, referenceType, referenceId, releaseAfter, status:'held'|'released'|'voided', reason }
               idx: {userId,source,referenceType,referenceId} unique · {status,releaseAfter}
coin_daily_caps{ _id:{userId,localDay}, total: Int, bySource: { steps, workout, streak, challenge, referral }, capped: Int }
               // conditional $inc with { total: { $lte: cap − grant } } — the daily ceiling (BACKEND §8.2.1)
coin_monthly_caps{ _id:{userId,month}, total: Int }   // only if coins.monthlyCap is set

// ───────────── engagement ─────────────
challenge_definitions { _id: String, title, description, emoji, metric, cadence, goal, rewardCoins, rewardsBadge, startsAt, endsAt, active }
challenge_enrollments { _id:{userId,challengeId,periodStart}, progress, completedAt, claimedAt }
achievements          { _id: String, label, metric, value, rule: Mixed }
user_achievements     { _id:{userId,achievementId}, achievedAt }
leaderboard_periods   { _id: String, scope, country, startsOn, endsOn, status, closedAt, paidAt }
leaderboard_scores    { _id:{periodId,userId}, score, reachedAt }             idx: {periodId,score:-1,reachedAt:1}
leaderboard_snapshots { _id:{periodId,rank}, userId, score, coinsPaid, perk }  idx: {periodId,userId} unique
reward_tiers          { _id: String, rankFrom, rankTo, coins, perks:[], medal, sort }

// ───────────── commerce ─────────────
shop_items     { _id: String, title, description, priceCoins, category, emoji, imageUrl, badge, isDeal, active, sort }
shop_inventory { _id: itemId, onHand (≥0 validator), lowStockAt }
orders         { _id, userId, status, totalCoins, addressSnapshot: Mixed, items:[{itemId,qty,priceCoins,title}],
                 placedAt, trackingRef, notes, events:[{from,to,actor,at}] }  idx: {userId,placedAt:-1} · {status,placedAt}

// ───────────── wellness ─────────────
hydration_entries   { _id, clientId, userId, ml, at, localDay, deviceId, deletedAt }          idx: {userId,localDay} · {userId,clientId} unique
hydration_reminders { _id: userId, enabled, reminders:[{id,time,slot,enabled}], sound, vibration, repeatDays:[Int] }
food_items          { _id: String, ownerUserId (null = global), name, portion, emoji, calories, proteinG, carbsG, fatsG, fiberG }
                    idx: text{name} or Atlas Search index · {ownerUserId}
food_entries        { _id, clientId, userId, slot, name, portion, calories, proteinG, carbsG, fatsG, fiberG, foodItemId, loggedAt, localDay, deletedAt }
                    idx: {userId,localDay} · {userId,clientId} unique
nutrition_goals     { _id: userId, calories, proteinG, carbsG, fatsG }
nutrition_preferences { _id: userId, dietType, mealPlan, goal }
planned_meals       { _id, userId, localDay, slot, time, calories, proteinG, carbsG, fatsG, items:[{name,quantity}], userAdded }  idx: {userId,localDay}
vital_readings      { _id, clientId, userId, kind, value, secondary, source, recordedAt, deletedAt }   idx: {userId,kind,recordedAt:-1} · {userId,clientId} unique
health_scores       { _id:{userId,localDay}, score, factors: Mixed }

// ───────────── social ─────────────
referral_codes  { _id: userId, code }                                   idx: {code} unique
referrals       { _id, inviterId, inviteeId, status, qualifiedAt, rewardedAt, rewardCoins, attribution:{link, campaign, deviceId} }
                idx: {inviteeId} unique · {inviterId,createdAt:-1}

// ───────────── messaging ─────────────
notifications   { _id, userId, topic, title, message, read, createdAt }  idx: {userId,createdAt:-1} · TTL 90d
campaigns       { _id, name, category, segment: Mixed, payload, scheduledAt, status, stats }

// ───────────── platform ─────────────
app_config      { _id: key, value: Mixed, updatedAt, updatedBy }
feature_flags   { _id: key, enabled, rollout: Number, cohorts:[String], platforms:[String], minVersion }
events          { _id, userId, deviceId, name, props: Mixed, at, appVersion }   // product analytics; TTL 400d or export to warehouse
content_quotes  { _id, text, active }
```

**Validators:** each collection gets a `$jsonSchema` generated from the matching zod schema in `packages/contracts` where one exists, plus hand-written constraints for `balance ≥ 0`, `onHand ≥ 0`, `amount ≠ 0`.
**Migrations:** versioned scripts in `packages/db/migrations` (e.g. `migrate-mongo`); index creation is declarative and diffed in CI.
**Sharding:** not needed at v1; if ever, shard key `userId` on `activity_samples`, `coin_ledger`, `food_entries`.

## 7. Jobs

| Queue | Job | Trigger | Idempotency |
|---|---|---|---|
| `activity` | `rollup(user, day)` | After ingest (debounced); hourly sweep | Upsert by `_id` |
| `integrity` | `scoreDay(user, day)`, `updateTrust(user)`, `fraudSweep` | After rollup; nightly | `trust_history` unique |
| `economy` | `releaseHolds`, `expiryWarn`, `expirySweep`, `reconcile` | Every 15 min; daily | Ledger unique index |
| `streak` | `evaluate(user, day)` | Midnight per tz bucket; after workout | `streak_days` `_id` |
| `engagement` | `recompute(user)`, `rescore(period)` | After rollup; 15 min | Deterministic |
| `leaderboard` | `close`, `pay` | Monday 00:00 per country | `status` state machine |
| `devices` | `versionStats`, `staleDevices`, `pushTokenCleanup` | Daily | Upsert |
| `wellness` | `generatePlan`, `healthScore`, `weeklyDigest` | Pref change; daily; weekly | Upsert |
| `messaging` | `dispatch`, `campaignSend` | Enqueue; scheduled | Notification id |
| `commerce` | `inventoryAlert` | Daily | — |
| `platform` | `eventsExport`, `retention` | Nightly | — |

Midnight jobs run hourly, selecting users whose local midnight just passed (`users.timezone`).

## 8. Environments

| Env | API | DB | Notes |
|---|---|---|---|
| local | `localhost:3000/v1` | `mongodb-memory-server` replset or Docker `mongo --replSet` | Seeded from `seedData.ts` fixtures |
| staging | `api.staging.vokve.app/v1` | Atlas M10 | SMS/email sandbox; attestation permissive; fraud shadow |
| production | `api.vokve.app/v1` | Atlas M30, continuous backup, PITR | Attestation enforced; trust tiers live |

## 9. Observability

Traces on every request with `deviceId`, `appVersion`, `platform` attributes. Metrics: `coins_minted_total{source}`, `coins_held_total`, `coins_released_total`, `coins_voided_total`, `coins_debited_total{source}`, `ingest_samples_total{provenance}`, `plausibility_score` histogram, `trust_tier_users{tier}`, `fraud_flags_total{layer,kind}`, `reconciliation_drift_coins` (= 0), `otp_sent_total{channel}`, `push_sent_total{result}`, `redeem_total{result}`, `devices_active{platform,version}`, `upgrade_required_total`. Alerts on drift, mint spikes, device sharing, attestation failure rate, OTP cost, ingest error rate. Dashboards: economy, fraud, fulfilment, ingest coverage, **version adoption**.

## 10. Testing

- Contract tests against `packages/contracts`.
- Ledger property tests: random credit/hold/release/void/debit/refund/expiry sequences → `balance = Σ ledger`, never negative, `E11000` on any replay.
- Transaction tests on a real replica set (`mongodb-memory-server` replset): redeem under 50 concurrent attempts with stock 1 → exactly one order.
- Streak golden tests ported from `__tests__/streakStore.test.ts`.
- Fraud fixtures: real Health Connect/HealthKit exports; manual entries; shaken-phone motion windows; emulator attestation; multi-account device.
- OTP tests: both channels, attempt/resend limits, TTL, purpose isolation (an email code cannot verify a phone challenge).
- Device tests: unregistered device → 428; blocked version → 426; refresh from wrong device → revoked.
- Timezone tests across midnight in three zones.

## 11. Client changes this architecture assumes

- Generate `installId` on first launch (Keychain/Keystore); call `POST /devices/register` before any authenticated call; send the seven `X-Vokve-*` headers on every request.
- Use `react-native-device-info` for the device profile and `isEmulator()`.
- Additive schema fields: `DailyActivity.distanceKm/source/verified/pendingCoins`, `LeaderboardEntry.isCurrentUser`, `Achievement.value` → number, `User.createdAt/country/phoneVerifiedAt/emailVerifiedAt/trustTier`, `VerificationChallenge.channel/target`, wallet `pending`.
- `{data, nextCursor}` envelope on `/workouts`; stores → read-through caches with an offline write queue (or `POST /sync`).
- Email-verification step after phone OTP (reuse `VerifyOtpScreen` with `channel: 'email'`).
