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
- **Food** (`modules/nutrition`) — `/nutrition/day`, `/days`, `/entries`, `/profile`, `/foods`, `/foods/quick-add`, `/foods/custom`, `/diet-plan`, `/diet-plan/days`, `/diet-plans`, `/diet-plans/:id`.
- **Vitals** (`modules/vitals`) — `/vitals`, `/vitals/latest`, `/health/score`.
- **Words** (`modules/content`) — `GET /content/tips/:topic`, one tip (or Home's motivation line) per topic per day.

Rewards that steps can earn — step coins, streak milestones, step-derived challenges, leaderboard prizes — all wait for ⚙ `coins.steps.enabled` (D-46); everything is recorded meanwhile.

## The admin API (food library and diet plans)

The diet plan library is content an operator writes, not something the app can
change: a plan is a named programme of days, tagged with the diet types and
meal plans it suits, and a member either picks one by name (`PUT
/nutrition/profile { selectedPlanId }`) or lets the server pick from the ones
that suit their preferences (RULES N10).

There is no admin account and no admin role on a member. `/v1/admin/*` answers
the operator's key alone — `ADMIN_API_KEY`, sent as `X-Admin-Key` — so no
member token can reach it, and with no key configured every admin route
answers 404 rather than advertising a door. Every write lands in `audit_log`
with the plan before and after it.

### Working with real plans, not the demo ones

The app ships with three demo plans so the screen has something behind it on a
fresh database. The first thing you will want is to see what is actually there
and get them out of the way:

```sh
npm run plans list          # every plan, and who wrote it (seed / admin / operator)
npm run plans resolve       # which plan each kind of member is given, and why
npm run plans show <id>     # one plan's days, printed as a menu
npm run plans import diet-plans.example.json   # add or replace from a file
npm run plans retire-seed   # the three shipped plans out of the library
npm run plans retire <id> | restore <id>
```

`resolve` is the one that answers "is this working?": it walks all sixteen
(diet type × meal plan) combinations and prints the plan a member with those
preferences would be handed, and whether it was chosen because it matched both
their preferences, only their diet type, or because it was the only plan left.
A combination with nothing written for it is named, so a gap is something you
decide about rather than discover from a member.

`retire-seed` refuses to leave the library empty: import your own first, or
members would land on a Diet Plan screen with nothing to show. Copy
`diet-plans.example.json`, replace every figure with your dietitian's, and
`import` it — the ids in the file are yours, so re-running the import replaces
those plans rather than piling up copies.

**A re-seed will not undo your work.** `npm run seed` restores the shipped
content, but it skips any plan or food whose `updatedBy` is no longer `seed` —
anything you have written or corrected through the admin API or this script is
yours from then on. A plan you only *retired* stays retired too.

The food library is the same story: the rows a member searches, browses and
quick-adds from are an operator's to write. A logged food keeps its own copy of
the figures (RULES N2), so fixing a wrong calorie count never rewrites what
anybody already ate, and retiring a food takes it off the shelf without
breaking the diary that points at it.

```sh
A=http://localhost:3000/v1; K='X-Admin-Key: <ADMIN_API_KEY>'

# the food library, a page at a time (retired rows included)
curl -s "$A/admin/foods?limit=50" -H "$K" | jq '{total, next: .nextCursor, foods: [.data[] | {name, portion, calories, quickAdd, active}]}'

# add a whole list at once — "Chapati 104 kcal | 1 piece (40 g)", and so on
curl -s -X POST $A/admin/foods -H "$K" -H 'Content-Type: application/json' -d '{
  "foods": [
    { "name": "Chapati", "portion": "1 piece (40 g)", "emoji": "🫓", "calories": 104, "proteinG": 3, "carbsG": 20, "fatsG": 1.5, "fiberG": 2, "sort": 20 },
    { "name": "Banana",  "portion": "1 medium (118 g)", "emoji": "🍌", "calories": 89, "proteinG": 1, "carbsG": 23, "fatsG": 0.3, "fiberG": 2.6, "quickAdd": true, "sort": 21 },
    { "name": "Orange",  "portion": "1 medium (130 g)", "emoji": "🍊", "calories": 62, "proteinG": 1.2, "carbsG": 15, "fatsG": 0.2, "fiberG": 3, "sort": 22 }
  ]
}' | jq '[.[] | {id, name}]'

# fix one (figures already eaten are untouched), or put it on the quick-add row
curl -s -X PUT $A/admin/foods/<id> -H "$K" -H 'Content-Type: application/json' \
  -d '{ "calories": 120, "quickAdd": true }' | jq '{name, calories, quickAdd}'

# take it off the shelf; {"active": true} puts it back
curl -s -X DELETE $A/admin/foods/<id> -H "$K" | jq '{name, active}'

# what is there (retired plans included)
curl -s $A/admin/diet-plans -H "$K" | jq '.[] | {id, name, active, days: (.days|length)}'

# write one — the whole programme in one call
curl -s -X POST $A/admin/diet-plans -H "$K" -H 'Content-Type: application/json' -d '{
  "name": "Lean Veg Reset",
  "description": "Three lighter vegetarian days, protein kept up.",
  "emoji": "🥗",
  "dietTypes": ["vegetarian", "eggetarian"],
  "mealPlans": ["balanced", "high_protein"],
  "days": [{ "label": "Day one", "meals": [
    { "slot": "breakfast", "time": "08:00", "calories": 320, "proteinG": 18, "carbsG": 42, "fatsG": 9,
      "items": [{ "name": "Oats with banana", "quantity": "1 bowl (200g)" }] },
    { "slot": "lunch", "time": "13:00", "calories": 450, "proteinG": 26, "carbsG": 58, "fatsG": 14, "items": [] },
    { "slot": "snack", "time": "17:00", "calories": 180, "proteinG": 6, "carbsG": 18, "fatsG": 11, "items": [] },
    { "slot": "dinner", "time": "20:00", "calories": 300, "proteinG": 32, "carbsG": 32, "fatsG": 11, "items": [] }
  ]}]
}' | jq '{id, name}'

# change it (fields left out keep what they had; `days` replaces the programme)
curl -s -X PUT $A/admin/diet-plans/<id> -H "$K" -H 'Content-Type: application/json' \
  -d '{ "name": "Lean Veg Reset v2", "sort": 4 }' | jq '{name, sort}'

# retire it: out of the library, and everyone who chose it falls back to the
# server's own choice (`released` says how many). `{"active": true}` puts it back.
curl -s -X DELETE $A/admin/diet-plans/<id> -H "$K" | jq '{released, active: .plan.active}'
```

## What a member did, and what their phone allows

Two separate things, kept apart on purpose (RULES P13, P14).

The **trail** is product analytics. The app queues an event for every screen it
opens and every action worth a row, keeps the queue across launches, and sends
it in batches to `POST /events`; the server attaches the device, platform,
version, build, OS and timezone from the request's own headers and answers
**202** with what it filed. A member who turned usage analytics off has the
whole batch dropped on arrival (P7) — accepted, not refused, because the app
should not have to know the setting. Rows live 400 days.

The **permission snapshot** is operational state: what each install's OS
currently allows, the whole set at once (`PUT /me/permissions`), with when each
answer last changed and the last twenty changes beside it. It is **kept even
for a member who opted out of analytics** — it is the first thing to look at
when steps read zero or a reminder never arrived, not a metric — and reporting
it never asks the member for anything.

The operator reads both, read-only, under the same admin key — along with
everything else the server knows about the member (RULES P15, P16):

```sh
A=http://localhost:3000/v1 ; K="x-admin-key: $ADMIN_API_KEY"

# who is this? (id, email, phone or part of a name) — each row says what they
# are running and when they installed it
curl -s "$A/admin/users?q=asha@example.com" -H "$K" | jq '.data[0]'

# the member in full: account, every phone, sessions, wallet, orders, trail
curl -s "$A/admin/users/<userId>" -H "$K" | jq '.account, .activity, .counts'
curl -s "$A/admin/users/<userId>" -H "$K" | jq '.installs[] | {
  model: .device.model, os: .device.osVersion, installed: .installedAt,
  installedWith: .app.firstVersion, running: .app.version,
  signedIn, signedInAt, lastActive: .lastActiveAt,
  push: .push.hasToken, denied: .permissions.denied }'

# every sign-in, newest first: when, on which phone, on which build
curl -s "$A/admin/users/<userId>/logins?limit=20" -H "$K" | jq '.data'

# where have they been, newest first (filter by name= or screen=, page with cursor=)
curl -s "$A/admin/users/<userId>/activity?limit=20" -H "$K" | jq '.data[] | {at, name, screen}'
curl -s "$A/admin/users/<userId>/activity?name=order_paid" -H "$K" | jq '.data'

# the same trail as a shape: screens by visits, actions by count, events by day
curl -s "$A/admin/users/<userId>/activity/summary?days=30" -H "$K" | jq '{events, sessions, screens: .screens[0:5], actions}'

# every phone on the account: what it allows, when that changed, and whether it can be pushed to
curl -s "$A/admin/users/<userId>/permissions" -H "$K" | jq '.data[] | {model, appVersion, hasPushToken, permissions, history}'

# why the app is not working for them (RULES P17): each phone's own verdict,
# when it last actually reported steps, and the faults it has hit
curl -s "$A/admin/users/<userId>/health" -H "$K" | jq '.devices[] | {
  model, appVersion, signedIn,
  lastUpload: .stepSync.uploadedAt,
  service: .health.tracking,         # looksDead, recoveryCount, battery, OEM
  healthConnect: .health.healthConnect,
  sync: .health.sync,                # status, queued, error, todaySteps
  stale: .health.stale }'
curl -s "$A/admin/users/<userId>/health?errors=50" -H "$K" | jq '.errors.data[] | {lastAt, count, kind, name, message, screen, appVersion}'
```

```sh
# the same thing as a verdict: what is wrong, worst first, with the fix (RULES P18)
curl -s "$A/admin/users/<userId>/problems" -H "$K" | jq '.summary.headline, (.findings[] | {severity, code, title, detail, fix})'

# and the same questions asked of every install — the list of what to fix next
curl -s "$A/admin/health/fleet?days=7" -H "$K" | jq '{installs, problems}'
curl -s "$A/admin/health/fleet?days=7" -H "$K" | jq '.byManufacturer, .byAppVersion[0:5]'
curl -s "$A/admin/health/fleet?days=7" -H "$K" | jq '.topErrors[] | {users, occurrences, fatal, name, message, appVersions}'
```

`/problems` is the one to open first: it reads the five endpoints above for you and says, for example, *"Redmi Note 12 has stopped counting — the OS killed the service"* with the recovery count, the battery setting and the OEM in the sentence, and the battery screen as the fix. An empty `findings` is a real answer — nothing is guessed to fill it. `/health/fleet` is the same logic as counts: `problems` is how many installs each thing is true of, `byManufacturer` is where the dead counters live (usually one or two names), `byAppVersion` puts a crash count beside an install count, and `topErrors` ranks the faults **fatal first, by the accounts they hit** rather than by how often one unlucky phone hit one.

**Reading the raw fields.** `service.looksDead` with a `recoveryCount` climbing and `batteryOptimizationEnabled: true` on an `aggressiveOem` is the commonest cause of "my steps stopped" — the fix is on the phone, in the OEM's battery settings, and the app has a screen for it. `healthConnect.canRead: false` after it was granted means the member revoked it in Settings. `sync.status: 'failed'` with a `queued` that never falls means the days are on the phone and not here — check `stepSync.uploadedAt` and RULES A28. And `health.stale: true` means this install has not said anything for a day and a half, which is itself the finding.

## Fake steps, and who looks at them

The layers have been scoring every day since the first snapshot (RULES A14–A25, `modules/activity/layers.ts`). What the server refuses outright, on evidence that needs no judgement call: an emulator, a forged attestation chain, an unlocked bootloader, a failed Play verdict, a key seen on another account, half the count flagged by the tracker's own checks, two in five motion windows non-walk, **a minute above 240 steps**, **a day above 120,000**, and **a day with no minutes, no motion and no allowed source behind more than 2,000 steps**. What costs score instead: a total the minutes cannot explain, motion sampling asked for and not delivered, a denylisted or hand-typed source, a pedometer ratio outside 0.7–1.3, round or identical totals, night steps.

**Three switches are off and are meant to go on for the rollout** (RULES A12, A24) — turn each on once the shadow period says what honest phones really send:

```sh
# a Keystore key that cannot be attested stops costing 40 points and refuses the day
# a day that carried no Play verdict does the same
# and a count the minutes cannot explain by more than 50% becomes a refusal
mongosh "$MONGODB_URI" --eval '
  db.app_config.updateOne({_id:"integrity"}, {$set:{"value.requireAttested":true,"value.requireVerdict":true}}, {upsert:true});
  db.app_config.updateOne({_id:"activity"}, {$set:{"value.thresholds.unaccountedShareHard":0.5}}, {upsert:true})'
```

The queue an operator reads them in (RULES A27), under the admin key:

```sh
A=http://localhost:3000/v1 ; K="x-admin-key: $ADMIN_API_KEY"

# who has something to answer for — hard flags first, with the coins still in escrow
curl -s "$A/admin/fraud/queue?days=30" -H "$K" | jq '.data[] | {email, flags, kinds, heldCoins, steps, verifiedSteps}'

# the case file: every flag, the days behind them with their layer scores, each phone's proof
curl -s "$A/admin/fraud/users/<userId>" -H "$K" | jq '{flags: .flags, day: .days[0], holds: .holds}'

# the verdict. confirm voids what that day was holding (RULES T7); dismiss gives the trust back
curl -s -X POST "$A/admin/fraud/flags/<flagId>/confirm" -H "$K" -H 'Content-Type: application/json' -d '{"note":"shaken phone"}' | jq
curl -s -X POST "$A/admin/fraud/flags/<flagId>/dismiss" -H "$K" -H 'Content-Type: application/json' -d '{}' | jq

# what a tightened threshold would have done to a real day, from the stored snapshot
curl -s -X POST "$A/admin/users/<userId>/days/2026-10-13/rescore" -H "$K" | jq '{before, after}'
```

**At checkout there is one more layer** (L7, RULES A19): coins spent within ⚙ 60 minutes of the account's first ever credit (`fast_redemption`) and one street line + postcode behind ⚙ 3 accounts (`address_reuse`). Both are soft flags raised before the order exists — so a farm's first cash-out is on the record even if the payment never completes — and neither refuses an order on its own; the gate behind them is the trust tier's (T5).

`POST /dev/steps` writes a day's verified steps and exists for exactly this kind of exercise — which is why it is off in production and off again wherever `DEV_ROUTES=false` (RULES A26). A server that mounts it says so in its first screen of logs.

## Shipping an update: the knock and the wall

Two kinds, one endpoint (RULES DV12). The app asks `GET /app/update` on launch
and on every return to the foreground, and the server answers `none`, `soft`
(a dismissible sheet, "Later" remembered for 24 h) or `hard` (a full screen
with no way past it but the store). Every word in the prompt is the server's,
so the same build can be asked nicely today and told firmly next week.

**Publishing a build is not forcing it.** These are two calls on purpose:

```sh
A=http://localhost:3000/v1 ; K="x-admin-key: $ADMIN_API_KEY"

# 1. you uploaded 1.3.0 (build 13) to Play. Tell the server — this is a KNOCK:
#    everyone below it gets the soft sheet, nobody is locked out.
curl -s -X POST "$A/admin/releases" -H "$K" -H 'Content-Type: application/json' \
  -d '{"platform":"android","version":"1.3.0","build":"13","status":"current","notes":"Faster step sync and the new shop."}' | jq

# 2. now make it mandatory — this is the WALL. Everything below 1.3.0 gets the
#    blocking screen, and every API call from it answers 426.
curl -s -X PUT "$A/admin/app/update-policy" -H "$K" -H 'Content-Type: application/json' \
  -d '{"minVersion":{"android":"1.3.0"}}' | jq

# the wall comes down the same way
curl -s -X PUT "$A/admin/app/update-policy" -H "$K" -H 'Content-Type: application/json' \
  -d '{"minVersion":{"android":"1.0.0"}}' | jq

# one broken build, without moving the minimum for everybody
curl -s -X POST "$A/admin/releases" -H "$K" -H 'Content-Type: application/json' \
  -d '{"platform":"android","version":"1.3.0","build":"14","status":"blocked"}' | jq

# what the fleet looks like, and which builds the minimum refuses
curl -s "$A/admin/releases?platform=android" -H "$K" | jq '{minVersion, data}'

# what a given build is told (the app sends these headers itself)
curl -s "$A/app/update" -H 'x-vokve-platform: android' -H 'x-vokve-app-version: 1.2.0' -H 'x-vokve-build: 12' | jq
```

Raising the minimum above what the store is serving is refused
(`NO_BUILD_TO_UPDATE_TO`): a wall with nowhere to go is worse than an old
build. The wording and the quiet window are config too —
`{"softTitle":"…","hardMessage":"Purana version {version} band ho gaya. {latest} install karein.","remindAfterHours":48}`
on the same call, and `{"nudgeOnNewer":false}` if only a `deprecated` version
should knock rather than every release.

## Notifications and push

`modules/notifications` is the feed (`GET /notifications`, `/counts`, read endpoints) and `notify()` is how anything tells a user something: feed row first, then a push if the topic's category switch is on, deferred to the end of quiet hours in the user's zone. Push goes out over FCM once `FIREBASE_SERVICE_ACCOUNT` is set (the service-account JSON, or a path to it — see `.env.example`; locally it lives in the gitignored `secrets/`); without it `lib/push.ts` logs `push.no_provider` and the feed row is the only channel. Two kinds go out: an ordinary message, which carries `android.notification.channelId: 'vokve.default'` — the id the app creates at launch and names in `firebase.json`, so do not change it on one side alone — and a **silent** data-only message (`{ silent: true }`), which carries no notification block at all so the OS shows nothing and hands it to the app's background handler instead (RULES A28). The app registers its token with `PATCH /devices/:id { pushToken }` after sign-in and withdraws it on sign-out.

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
# Vokve-Backend
