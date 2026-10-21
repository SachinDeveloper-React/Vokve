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

## Secrets

**Every key this server holds comes from the environment.** There is no credential file the code reads at boot and no secret in the repo — `.env` locally, the hosting panel's environment in a deployment, and `.env.example` is the list of names with no values in it. `config/env.ts` validates them all once at startup, so a missing or malformed one fails the process there rather than surfacing as a confusing error an hour later.

Google service accounts are the awkward case, because Google hands them over as a JSON file. Their three useful fields go in as three variables — for push, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` (and the `PLAY_INTEGRITY_*` trio for integrity verdicts). The private key is a PEM: keep it on one line in double quotes with its newlines written `\n`, exactly as the JSON has it, which is also the only form a dashboard can store. `config/serviceAccount.ts` puts the newlines back on the way out, and refuses a half-filled set by name instead of quietly leaving push switched off.

The downloaded JSON stays in `secrets/`, which is gitignored (as is anything named `*service-account*.json`, wherever it lands) — it is the copy to re-read the values from, not something the server loads. The single-variable forms, `FIREBASE_SERVICE_ACCOUNT` / `PLAY_INTEGRITY_SERVICE_ACCOUNT` holding either the whole JSON or a path to it, still work for a deployment already set up that way; the three keys win when both are present.

Nothing secret has ever been committed — `.env` and `secrets/` are ignored in both this repo and the app's. If a key does leak, rotating it is the fix, not deleting the commit: generate a new private key in Firebase (Project settings → Service accounts) and a new app password for SMTP, then update the environment.

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

Play Integrity needs a service account (`PLAY_INTEGRITY_PROJECT_ID`, `PLAY_INTEGRITY_CLIENT_EMAIL`, `PLAY_INTEGRITY_PRIVATE_KEY`) and the Cloud project number (`PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER`, or `integrity.playIntegrity.cloudProjectNumber` in `app_config`); without them no verdict is asked for. Set `integrity.android.signingCertSha256` to the release certificate's SHA-256 before production so a re-signed APK's key is not attested.

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

# delete it outright — the draft nobody followed. Its own path, because
# retiring and deleting are different acts and only one is reversible.
curl -s -X DELETE $A/admin/diet-plans/<id>/permanent -H "$K" | jq '{deleted, released}'
```

### A spreadsheet of foods

The food library is the other half of the same job, and it usually arrives as
a sheet somebody keeps elsewhere. `POST /admin/foods/import` takes the rows as
JSON — the panel reads the `.xlsx` or `.csv` and sends them, so this API stays
JSON end to end and a script can drive the same import.

```sh
# what it would do, without writing anything
curl -s -X POST $A/admin/foods/import -H "$K" -H 'Content-Type: application/json' \
  -d '{ "dryRun": true, "rows": [
        { "line": 2, "name": "Chapati", "portion": "1 piece (40 g)", "calories": 104, "proteinG": 3, "carbsG": 20, "fatsG": 1 },
        { "line": 3, "name": "Banana",  "portion": "1 medium",       "calories": 105, "proteinG": 1, "carbsG": 27, "fatsG": 0 }
      ]}' | jq '{created, updated, duplicates, failed}'
# → {"created":1,"updated":1,"duplicates":0,"failed":[]}

# and for real
curl -s -X POST $A/admin/foods/import -H "$K" -H 'Content-Type: application/json' -d @foods.json | jq '{created, updated}'

# a row imported from the wrong column goes outright: a logged meal keeps its
# own copy of every figure (N2), so nothing anybody ate changes.
curl -s -X DELETE $A/admin/foods/<id>/permanent -H "$K" | jq '{deleted}'
```

Rows are matched **by name**, case-folded, among the global rows. A sheet has
no ids in it — somebody typed "Chapati", not `food_7f3a` — so the name is the
only key the two sides share, and matching on it is what makes a second upload
an edit rather than a second Chapati. `line` is the sheet's own row number and
comes back on anything refused, so a message names the line to fix.

`GET /admin/nutrition/overview` is the read above all of it: how much library
there is, how many quick-add tiles, which plans members are actually on, and
what ⚙ `nutrition.*` gives somebody who has set nothing.

## Challenges and badges (RULES C1–C7)

Both were seed data until an operator needed to run a weekend challenge:
changing what one pays, opening it, or adding a badge meant editing
`seed/data.ts` and deploying. Both are rows the app reads live now.

```sh
# every challenge, with what it has actually paid
curl -s "$A/admin/challenges" -H "$K" | jq '{totals, data: [.data[] | {id, title, goal, rewardCoins, state, completions}]}'

# one that opens on Saturday — the id is written from the title
curl -s -X POST $A/admin/challenges -H "$K" -H 'Content-Type: application/json' \
  -d '{ "title": "12K Steps Weekend", "metric": "steps", "cadence": "daily", "goal": 12000,
        "rewardCoins": 250, "rewardsBadge": true, "badgeId": "a-10k-steps",
        "startsOn": "2026-11-07", "endsOn": "2026-11-09" }' | jq '.challenge | {id, state}'

curl -s -X PUT $A/admin/challenges/ch-12k-steps-weekend -H "$K" -H 'Content-Type: application/json' \
  -d '{ "goal": 14000 }' | jq '.challenge | {goal}'

# off every board; the completions that paid somebody stay readable
curl -s -X DELETE $A/admin/challenges/ch-12k-steps-weekend -H "$K" -H 'Content-Type: application/json' -d '{}' | jq '.challenge.active'
# and outright, which is refused the moment anybody has finished it
curl -s -X DELETE $A/admin/challenges/ch-draft/permanent -H "$K" -H 'Content-Type: application/json' -d '{}' | jq '{deleted}'

# the badge shelf: who holds each one, and what pays it
curl -s "$A/admin/achievements" -H "$K" | jq '{totals, data: [.data[] | {id, label, rule, members, awardedBy: [.awardedBy[].title], unreachable}]}'
curl -s -X POST $A/admin/achievements -H "$K" -H 'Content-Type: application/json' \
  -d '{ "label": "12K Steps", "value": 12000, "metric": "steps", "rule": "best_day_steps", "rewardCoins": 120 }' | jq '.achievement.id'
```

Three rules the writes hold to, and each exists because of what points at a
row rather than because of the row itself:

- **A challenge anybody has finished is retired, never deleted.** A completion
  row is what paid their coins (C4) and the ledger entry beside it names the
  challenge; deleting the definition would leave both pointing at nothing.
- **A badge somebody holds is never deleted** (C7 — unlocked once, never taken
  back), and never while a challenge still awards it: the next completion
  would pay out a badge that is not there. The list marks the opposite problem
  too — `unreachable`, a badge with no rule and no challenge, which nothing
  can ever unlock.
- **Coins here are held by the same switches as everywhere else.** A reward is
  recorded and paid when ⚙ `coins.achievements.enabled` allows it (D-46), so
  `completions.unpaid` on a challenge is usually the switch or the daily
  ceiling rather than the challenge.

## The gym: exercises, and the templates built from them

```sh
# everything, with what uses what
curl -s "$A/admin/training" -H "$K" | jq '{totals, templates: [.templates[] | {id, title, exercises: [.exercises[].name], missing}]}'

# an exercise — the id is written from the name
curl -s -X POST $A/admin/training/exercises -H "$K" -H 'Content-Type: application/json' \
  -d '{ "name": "Landmine Press", "muscleGroup": "shoulders", "equipment": "barbell" }' | jq '.exercises[-1]'

# a workout built on it. `exerciseIds` is the order they are done in, and
# `muscleGroups` follows the exercises unless it is named.
curl -s -X POST $A/admin/training/templates -H "$K" -H 'Content-Type: application/json' \
  -d '{ "title": "Shoulder Day", "estimatedMinutes": 40, "exerciseIds": ["landmine-press"] }' | jq '.templates[-1] | {id, muscleGroups}'

curl -s -X DELETE $A/admin/training/templates/shoulder-day -H "$K" -H 'Content-Type: application/json' -d '{}' | jq '{deleted}'
curl -s -X DELETE $A/admin/training/exercises/landmine-press -H "$K" -H 'Content-Type: application/json' -d '{}' | jq '{deleted}'
```

The relationship to watch is a template's exercises. The app's template
contract carries **whole exercises**, not ids, so a template naming an
exercise that is not there is one the phone *drops* — silently, from the
member's point of view. Hence two rules:

- a template is checked against the exercise list on the way in (422 naming
  the ids nothing answers to), and
- an exercise a template uses is not deleted; the refusal names the
  templates to take it out of first. `missing` on a template read is the
  same problem found after the fact, in a row somebody wrote by hand.

A finished workout is a member's own record and is never touched here: it
carries its own copy of every exercise and set, so correcting a name or a
muscle group fixes the catalogue from now on and leaves the history alone.

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

## The dashboard's own numbers

Everything above answers a question about one member or one install. Two reads
answer the questions that are about the product — is it growing, is it being
used, and what has it cost:

```sh
A=http://localhost:3000/v1 ; K="x-admin-key: $ADMIN_API_KEY"

# one window, every figure taken at the same instant
curl -s "$A/admin/analytics/overview?days=30" -H "$K" | jq '{window, members: .members | {total, new, newPrevious, emailVerified}, installs: .installs | {active, signedIn, pushable}}'
curl -s "$A/admin/analytics/overview?days=30" -H "$K" | jq '{engagement: .engagement | {dau, wau, mau, stickiness, events, sessions}, activity: .activity | {steps, verifiedSteps, verifiedShare, avgStepsPerMemberDay}}'
curl -s "$A/admin/analytics/overview?days=30" -H "$K" | jq '.economy, .integrity'
curl -s "$A/admin/analytics/overview?days=30" -H "$K" | jq '.engagement.topScreens[0:5], .activity.byDay[-7:]'

# the newest accounts, name and date only
curl -s "$A/admin/analytics/signups?limit=8" -H "$K" | jq '.data[] | {name, email, signedUpAt}'
```

One call rather than eight because a dashboard that loads eight endpoints shows
eight clocks, and the first thing anybody does with two of those is wonder
which is right. Three things about the figures are worth knowing before anyone
argues with them:

**Every figure says where it came from.** `engagement.dau/wau/mau` are distinct
accounts whose phones made a request — the device heartbeat (RULES DV1), which
every account writes. `engagement.events/sessions/byDay/topScreens` come from
the trail, which is dropped on arrival for an account with usage analytics off
(RULES P7). They are deliberately not added together, and `trailMembers` is
there so the two can be read against each other.

**A day is the operator's own day.** Everything bucketed by date uses the zone
in `X-Vokve-Timezone` (default ⚙ `locale.timezone`), and the window it covers
is named in `window`.

**The standing position is not a window figure.** `economy.coins.balance`,
`pending`, `held` and `lifetimeEarned` are what the balances and the escrow
hold right now, whatever `days` says; `earned`, `spent` and `bySource` are the
ledger's rows inside the window.

`members.newPrevious` is the same length of window immediately before it, so a
dashboard can show a trend rather than guess at one. `activity.verifiedShare`
is the same number the shadow report is judged on — see `/admin/activity/shadow`
below for the decision it belongs to.

These reads are aggregations over `users`, `devices`, `events`,
`activity_daily`, `coin_ledger`, `orders` and `fraud_flags`. At a few hundred
thousand members the trail aggregation is the one to watch: `events` is indexed
for one member's trail and for one event name across accounts, and a window
sweep over every row is neither.

## Turning the step pipeline’s knobs

Everything that decides what happens to a member’s steps was already config —
what the phone is told to count, when it must have reported by, what the
layers refuse, what a verified day is worth, what each trust tier lets
through. None of it was reachable without a database client, which made it a
deploy-time decision wearing config’s clothes. Two routes fix that:

```sh
A=http://localhost:3000/v1 ; K="x-admin-key: $ADMIN_API_KEY"

# what is in force, beside what the code ships, and every key that differs
curl -s $A/admin/config/steps -H "$K" | jq '{overrides, updatedBy, updatedAt}'
curl -s $A/admin/config/steps -H "$K" | jq '.effective.activity | {maxAgeDays, syncNudge, verifiedMinScore}'

# change two of them (any subset; dotted paths are written, not whole sections)
curl -s -X PUT $A/admin/config/steps -H "$K" -H 'Content-Type: application/json' \
  -d '{"patch":{"activity":{"maxAgeDays":10,"syncNudge":{"silentAfterHours":12}}},"note":"tighter window"}' | jq '.overrides'

# and put one back to the code's default
curl -s -X PUT $A/admin/config/steps -H "$K" -H 'Content-Type: application/json' \
  -d '{"reset":["activity.maxAgeDays"]}' | jq '.overrides'
```

Three things make this safe to expose, and they are the reason the surface is
shaped this way rather than as a general "write any config key":

**A patch is checked before it is written.** `validate()` in
`config/remote.ts` runs on *read*, so a bad document would not fail the write
that caused it — it would fail every `getConfig()` in the process, for every
member, until somebody worked out which key did it. The patch is merged onto
the live config in memory, validated there, and only then persisted. A refusal
carries the validator’s own sentence, which is what an operator needs to read:

```
{"error":{"code":"VALIDATION_FAILED","details":{"config":"coins.sourceCaps.steps (900) exceeds coins.dailyCap (300)"}}}
```

**Only the keys it owns exist.** The schema is a closed list with `.strict()`
at every level over `activity`, `coins.steps`/`sourceCaps.steps`/`dailyCap`,
`trust.stepCaps`/`holdHours`/`tiers`/`shadow` and `telemetry`. A typo is a 422
rather than a stray key that silently does nothing — `deepMerge` would happily
have added it.

**Stored is not overridden.** The seed writes a copy of every config section
on a fresh database (`$setOnInsert`), so most of what is in `app_config` is a
default sitting in a document. `overrides` lists only where the stored value
and the code have parted, which also catches the case nobody would otherwise
notice: *a default the code has since changed, pinned by a copy an older seed
wrote.*

## One member’s own settings, and what we tell them

The config above is everybody’s. This is the half that is one member’s — the
goal they set, the ceiling their tier puts on a day, when each of their phones
last reported, what they have agreed to hear — and the two things support
actually has to *do*.

```sh
# everything at once: goal (with the suggestion and the range), ceiling,
# phones, reachability, preferences, quiet-hours state right now
curl -s $A/admin/users/<userId>/config -H "$K" | jq '{account, steps: .steps | {goal, ceiling, coins, upload}, notifications}'
curl -s $A/admin/users/<userId>/config -H "$K" | jq '.steps.installs[] | {label, signedIn, stepSync, push, permissions}'

# the little of it an operator may change
curl -s -X PUT $A/admin/users/<userId>/config -H "$K" -H 'Content-Type: application/json' \
  -d '{"dailyStepGoal":8000,"timezone":"Asia/Kolkata","note":"asked on chat"}' | jq '.steps.goal'

# "stop sending me this" — off only (see below)
curl -s -X PUT $A/admin/users/<userId>/config -H "$K" -H 'Content-Type: application/json' \
  -d '{"silence":["activity"],"quietHours":{"enabled":true,"start":"23:00","end":"07:30"}}' | jq '.notifications.preferences'

# their notification centre, with what became of each push
curl -s "$A/admin/users/<userId>/notifications?limit=25" -H "$K" | jq '.data[] | {createdAt, topic, title, pushedAt, pushDeferredUntil, read}'

# tell them something, through the same path every job uses
curl -s -X POST $A/admin/users/<userId>/notifications -H "$K" -H 'Content-Type: application/json' \
  -d '{"topic":"steps","title":"About your steps","message":"The sync on your phone is fixed.","note":"ticket 412"}' | jq
# → {"id":"ntf_…","status":"created","push":"sent"}   or "category_off", "deferred", "no_device", "no_provider"

# the hourly job's silent "sync now" push, sent to this member's phones at once
curl -s -X POST $A/admin/users/<userId>/sync-nudge -H "$K" -H 'Content-Type: application/json' \
  -d '{"remind":false}' | jq '{pushed, results}'
```

**What may be written here is deliberately narrow.** The step goal and the
timezone, because both are states a member can get into and not out of (a goal
saved on a phone that then broke; a zone set on a flight) and both are visible
to them afterwards. And **a notification switch may be turned off, never on**:
"stop sending me this" is a support request, "start sending them this" is
consent, and consent is not an operator’s to give — the member turns it back
on in the app, where they can see what they are agreeing to. There is no shape
in the API for turning one on. Everything else about the account stays
read-only, as the rest of the operator surface is.

An operator cannot talk past a switch either: `POST …/notifications` goes
through `notify()` like every job, so a member who has silenced that category
gets the feed row and no push, and the answer says `category_off` rather than
pretending. `sync-nudge` skips the job’s cooldown on purpose — an operator
pressing it has a member on the phone — but still stamps `nudgedAt`, so the
hourly job does not immediately push the same install again.

Both routes write an audit row (`member.config`, `member.notify`,
`member.sync_nudge`, `config.steps`) with the operator’s note on it.

## The rest of one member: steps, coins, badges, orders

Four reads that were only ever answerable to the member themselves — and all
four are things support is asked about:

```sh
A=http://localhost:3000/v1 ; K="x-admin-key: $ADMIN_API_KEY"

# what they have walked, day by day, with what judged each day
curl -s "$A/admin/users/<userId>/steps?days=30" -H "$K" | jq '{window, goal, totals, streak}'
curl -s "$A/admin/users/<userId>/steps?days=30" -H "$K" | jq '.data[] | {localDay, steps, verifiedSteps, stepsCredited, verified, goalHit, plausibility, hardRejects}'
curl -s "$A/admin/users/<userId>/steps?from=2026-10-01&to=2026-10-07" -H "$K" | jq '.totals'

# where those steps came from: the window by source, the last steps and what answered for them,
# and per day the source the figure came from with every other app that wrote one (D-51)
curl -s "$A/admin/users/<userId>/steps?days=30" -H "$K" | jq '{bySource, last}'
curl -s "$A/admin/users/<userId>/steps?days=30" -H "$K" | jq '.data[] | {localDay, steps, source, answered: .sourceApp.appName, sources: [.sources[] | {appName, steps, status, answered}]}'

# and one day in depth: which phone each minute went to, which source answered, and each source's own hours
curl -s "$A/admin/users/<userId>/steps/timeline?date=2026-10-21" -H "$K" | jq '{scored, totals, sources: [.sources[] | {appName, steps, status, answered}]}'
curl -s "$A/admin/users/<userId>/steps/timeline?date=2026-10-21" -H "$K" | jq '[.sourceHours[] | select(.bySource != []) | {hour, steps, bySource}]'

# the wallet, the escrow, the daily ceilings, the totals by source
curl -s $A/admin/users/<userId>/wallet -H "$K" | jq '{balance, totals, bySource}'
curl -s $A/admin/users/<userId>/wallet -H "$K" | jq '.holds[], .dailyCaps[0]'

# and the rows behind it — append-only, so these *are* the arithmetic
curl -s "$A/admin/users/<userId>/ledger?limit=50" -H "$K" | jq '.data[] | {createdAt, title, source, amount, referenceType, actor}'
curl -s "$A/admin/users/<userId>/ledger?direction=out&source=purchase" -H "$K" | jq '.data'

# the whole badge shelf with their own unlocks on it, and the challenges that paid
curl -s $A/admin/users/<userId>/achievements -H "$K" | jq '{summary, locked: [.badges[] | select(.unlocked == false) | .title]}'
curl -s $A/admin/users/<userId>/achievements -H "$K" | jq '.challenges[] | {title, period, progress, goal, rewardCoins, granted, status}'

# what they bought, and one order in full
curl -s "$A/admin/users/<userId>/orders?status=delivered" -H "$K" | jq '{totals, data: [.data[] | {number, status, payable, coinsUsed, placedAt}]}'
curl -s $A/admin/orders/<orderId> -H "$K" | jq '{number, status, money, payment, items, address, events}'
```

Three things worth knowing before the figures are argued with. **`steps` is
keyed by the member's own local day** and the goal it is measured against is
the one *they* set, not the default — `goalHit` would otherwise be a different
question from the one their app answers. **`stepsCredited` is the high-water
mark** (RULES A4): steps already paid or held for that day, which is why
re-scoring a day never pays twice. And **`granted` on a challenge is what was
actually paid**, which is less than `rewardCoins` where the daily ceiling bit
and zero while step-derived rewards wait for `coins.steps.enabled` — that is
what `status: "unpaid"` means there.

The order figures are the till's, as the order was placed (RULES R11): paise
for money, coins for coins, and the address is the snapshot, so a member who
has moved still sees where it went.

## Freezing an account, and correcting what it was paid

The two things an operator may *change* about an account, kept apart from the
reads so nothing on a reading screen can write by accident. Both need a
reason; both write an audit row.

```sh
# frozen stops it spending and leaves everything else alone; a legal hold
# keeps it out of the deletion job's way
curl -s -X PUT $A/admin/users/<userId>/status -H "$K" -H 'Content-Type: application/json' \
  -d '{"frozen":true,"reason":"chargeback dispute"}' | jq

# a correction to what they were paid — positive credits, negative claws back
curl -s -X POST $A/admin/users/<userId>/coins -H "$K" -H 'Content-Type: application/json' \
  -d '{"amount":250,"title":"Goodwill credit","reason":"ticket 412 — order arrived broken"}' | jq
curl -s -X POST $A/admin/users/<userId>/coins -H "$K" -H 'Content-Type: application/json' \
  -d '{"amount":-100,"title":"Correction","reason":"fraud confirmed on 2026-10-14"}' | jq

# every operator action on the account, newest first — and the member's own
curl -s "$A/admin/users/<userId>/audit?limit=20" -H "$K" | jq '.data[] | {at, action, actorType, actorId, after}'
```

**An adjustment is a new row, never an edit.** The ledger is append-only
(RULES E2), so a clawback reads in the member's own wallet as a line they can
see rather than as coins that quietly vanished — and this is the tool the
fraud queue points at, since confirming a flag voids only what a day was
*holding* and coins already released can be answered no other way. A credit
goes through `credit()` with the daily ceiling waived, because a correction is
not earnings. A clawback is **refused rather than clamped** when the balance
will not cover it: a balance that cannot go below zero would otherwise turn
"take 500 back" into "take whatever is left", silently. Either way the
operator is named on the row (`actor`), and 10,000 coins in one go is the
ceiling on what this surface will decide.

**`GET /admin/users`** grew the filters a list is actually narrowed by:
`tier`, `platform` (accounts with a live install on it), `status` — `frozen`,
`unverified`, `deleting`, `deleted` — `sort` (`newest`, `oldest`, `name`,
`trust`) and `offset`, with `total` beside the page so it can say what it is a
page of.

## Doing something about an order (RULES R10, R11)

Three verbs and a book. The book is every order rather than one member's,
because "what needs packing" and "what is stuck unpaid" are questions about
the shop:

```sh
A=http://localhost:3000/v1 ; K="x-admin-key: $ADMIN_API_KEY"

# the order book, with the shop's mixed economy as a filter
curl -s "$A/admin/orders?status=placed" -H "$K" | jq '{total, byStatus, totals}'
curl -s "$A/admin/orders?paidWith=coins" -H "$K" | jq '.data[] | {number, coinsUsed, payable, inCoins}'

# forwards only, and never out of a finished state
curl -s -X PUT $A/admin/orders/<orderId>/status -H "$K" -H 'Content-Type: application/json' \
  -d '{"status":"shipped","trackingRef":"BLR-99812"}' | jq

# the member's own cancel, asked for by an operator: coins, stock, coupon, gateway
curl -s -X POST $A/admin/orders/<orderId>/cancel -H "$K" -H 'Content-Type: application/json' \
  -d '{"reason":"wrong size"}' | jq

# and the narrow verb for an order that has already happened
curl -s -X POST $A/admin/orders/<orderId>/refund -H "$K" -H 'Content-Type: application/json' \
  -d '{"reason":"arrived broken"}' | jq   # add "amount" in paise for a part refund

# the typo case: the order's own address snapshot, while the parcel is still here
curl -s -X PUT $A/admin/orders/<orderId>/address -H "$K" -H 'Content-Type: application/json' \
  -d '{"line1":"14 MG Road, Flat 3","reason":"member read it out wrong"}' | jq
```

**A cancel is not a refund.** Cancelling goes through the same `releaseOrder`
the member's own cancel and the unpaid-order sweep use — the coins, the stock,
the coupon and the gateway refund cannot be remembered by one caller and
forgotten by another. Refunding is for an order that has happened: the money
and the coins go back and **the stock does not**, because it is in somebody's
house. A gateway that refuses a refund leaves the order `refunded` with the
payment still reading `paid`, exactly as the member's cancel does: that
mismatch is what support looks for, and hiding it would be worse.

**The address is patched on the order, not in the address book.** An order
carries a snapshot (RULES R4); fixing the book would change where the *next*
order goes and leave this one on its way to the wrong flat. Allowed up to
`confirmed` — past that the label is printed, and changing the record would
make it lie.

### An order paid in coins has no money side

`paidWith` is computed once, server-side, and is on both the list and the
detail read, so nothing downstream has to guess:

- **`coins`** — `inCoins` is set, which the till does only when *every* line
  is a coins-only item. Then the coin figures **are** the price (goods,
  discount, and delivery in coins too) and `payable` is 0. The paise on the
  row are the conversion, not a bill anybody was sent, **so no rupee figure
  should ever be shown for one of these.**
- **`money`** — no coins were spent.
- **`mixed`** — coins covered the shop's share and money the rest, split per
  line as `items[].coinsUsed` / `items[].moneyPaid`.

An item's own `paymentMode` decides which of the three an order can be, and
`null` follows ⚙ `commerce.paymentMode` — so a coins-only reward sits on the
same shelf as a money-only product.

**One bug worth knowing about, fixed here:** `order.coinsUsed` is written by
`checkout` as **whole coins** (`q.coinsApplied`), not milli-coins. Every admin
read was passing it through `toCoins()`, so a 300-coin order read as `0.3` —
and the fixtures that tested it were written in milli-coins, which made the
two agree with each other instead of with the till. Coins on an order are
coins; `coinsValue` beside them is paise.

## The shelf, and what may buy it

```sh
# the catalogue as the operator needs it: retired rows, stock, and the mode in force
curl -s "$A/admin/shop/items?state=any&limit=50" -H "$K" | jq '{total, shop, data: [.data[] | {id, title, price, coinPrice, paymentMode, effectivePaymentMode, stock, active}]}'
curl -s "$A/admin/shop/items?paymentMode=coins" -H "$K" | jq '.data[].title'

# list something, or rewrite it — idempotent on the slug
curl -s -X POST $A/admin/shop/items -H "$K" -H 'Content-Type: application/json' \
  -d '{"id":"reward-band","title":"Reward Band","price":5000,"category":"gym","paymentMode":"coins","onHand":25}' | jq '.created, .item.coinPrice'

# the one field somebody came to change
curl -s -X PUT $A/admin/shop/items/reward-band -H "$K" -H 'Content-Type: application/json' -d '{"price":4000}' | jq '.item.price'

# off the shelf, and back on — never a delete
curl -s -X DELETE $A/admin/shop/items/reward-band -H "$K" -H 'Content-Type: application/json' -d '{"note":"out of season"}' | jq '.item.active'

# stock, the other half of an order going wrong
curl -s -X PUT $A/admin/shop/items/reward-band/stock -H "$K" -H 'Content-Type: application/json' \
  -d '{"onHand":12,"reason":"counted after the fair"}' | jq
```

`price` is paise and `coinPrice` is the same figure rounded **up** to whole
coins — up, because a coins-only order has no money to make up a shortfall.
Retiring is `active: false`: the item leaves the member's shelf and every
order that holds it stays readable, because an order carries its own snapshot
of what was bought.

### One product in full, and the two ways to end one

```sh
# the four questions that are not on the item: sales, who is waiting for it,
# what members wrote, and who changed it last
curl -s "$A/admin/shop/items/tee/insight" -H "$K" | jq '{sales, wanted, orders: (.orders | length), reviews: {average, count}, trail: (.trail | length)}'

# deleting it outright — its own path, because the two acts are different
curl -s -X DELETE $A/admin/shop/items/draft-tee/permanent -H "$K" -H 'Content-Type: application/json' \
  -d '{"note":"listed by accident"}' | jq
# → {"deleted":true,"id":"draft-tee","basketsTidied":1,"savesRemoved":1,"reviewsRemoved":1}
```

`DELETE /admin/shop/items/:id` **retires**; `DELETE …/:id/permanent` deletes.
Separate paths on purpose: only one of them is reversible, and the choice
between them is not a flag somebody should be able to miss.

The permanent one is for the mistake case — a slug typed wrong, a draft
listed by accident, a duplicate. **An item any order holds is refused**
(422), and the refusal says to retire it instead. Not because the order
would break — an order carries its own snapshot (RULES R11) — but because
deleting the row breaks the link from the order *back* to the product, which
is what support follows when somebody asks what they received. What it does
clean up is everything that points at the row and would otherwise dangle:
stock, basket lines, saves and reviews.

## Shelves, and the subcategories under them (RULES R9)

```sh
# what each shelf is carrying, with every subcategory under it
curl -s "$A/admin/shop/categories" -H "$K" | jq '{icons, totals, data: [.data[] | {category, name, icon, items, stockValue, unitsSold, wanted, subcategories: [.subcategories[].name]}]}'

# a new shelf — the slug is written from the name unless one is given
curl -s -X POST $A/admin/shop/categories -H "$K" -H 'Content-Type: application/json' \
  -d '{"name":"Yoga & Pilates","icon":"heart"}' | jq '{slug, created}'
# → {"slug":"yoga-pilates","created":true}

# rename it, re-order it, or take it off the app. Never re-key it.
curl -s -X PUT $A/admin/shop/categories/yoga-pilates -H "$K" -H 'Content-Type: application/json' \
  -d '{"name":"Yoga","sort":2}' | jq '.data[] | select(.category=="yoga-pilates") | {name, sort}'

# delete it — `moveTo` is required while anything is still on it
curl -s -X DELETE $A/admin/shop/categories/yoga-pilates -H "$K" -H 'Content-Type: application/json' \
  -d '{"moveTo":"gym"}' | jq '{deleted, moved, movedTo}'

# the subcategories: add one, rename it across its items, remove it
curl -s -X POST $A/admin/shop/categories/clothing/subcategories -H "$K" -H 'Content-Type: application/json' \
  -d '{"name":"Tees"}' | jq '.created'
curl -s -X PUT $A/admin/shop/categories/clothing/subcategories/T-shirts -H "$K" -H 'Content-Type: application/json' \
  -d '{"name":"Tees"}' | jq '{moved, mergedWith}'
curl -s -X DELETE $A/admin/shop/categories/clothing/subcategories/Tees -H "$K" -H 'Content-Type: application/json' \
  -d '{"reassignTo":"Hoodies"}' | jq '{deleted, moved, reassignedTo}'

# the two bulk writes, declared above `/:slug` so it cannot swallow them
curl -s -X PUT $A/admin/shop/categories/subcategory -H "$K" -H 'Content-Type: application/json' \
  -d '{"category":"clothing","from":"T-Shirts","to":"T-shirts"}' | jq '{moved, mergedWith}'
curl -s -X POST $A/admin/shop/categories/move -H "$K" -H 'Content-Type: application/json' \
  -d '{"ids":["cap","socks"],"category":"accessories","subcategory":"Bags"}' | jq '{moved, missing}'
```

The shelves were a zod enum until an operator needed a fifth one. They are
rows in `shop_categories` now, and `GET /shop/categories` sends the app each
shelf's **label** and **icon** beside its counts — so a shelf added this
afternoon draws itself on a phone installed last month, and
`shopCategorySchema` is a slug rather than four names.

The two halves of "category" are still not the same kind of thing, and the
difference decides what each write is careful about:

- **A shelf is a row keyed by its slug**, which is what every item's
  `category`, every filter link and every saved search carries. So the name
  and the icon change freely and the slug never does, and deleting a shelf
  has to say which shelf its items move to (they arrive unfiled — the
  subcategory they were under belonged to the shelf they left). Retiring one
  (`active: false`) takes it off the app and leaves every item where it is.
- **A subcategory is a name on the item.** The shelf lists them so the panel
  can offer a dropdown rather than a text box — which is what stops
  "T-Shirts" sitting beside "T-shirts" — but the item carries the string, so
  a rename is a write across every item that holds it, and renaming one onto
  a name the shelf already has is how two are merged.

An item write is refused (422) when its shelf does not exist, or when its
subcategory is not one of that shelf's: the dropdowns are a convenience, and
this API is also called by hand.

A database that predates the collection is not a migration to remember: the
first read builds a shelf for every category the items are already carrying,
and adds any subcategory typed onto an item that its shelf does not list.

Neither touches a basket or an order: a basket keys on the item's slug, and an
order carries its own snapshot.

## Coupons (RULES R16)

```sh
# every coupon, with what it has actually given away
curl -s "$A/admin/shop/coupons?state=live" -H "$K" | jq '{totals, data: [.data[] | {code, kind, value, state, redemptions, remaining, given, deletable}]}'

# one of them, with who claimed it and the orders that hold it
curl -s "$A/admin/shop/coupons/WELCOME10" -H "$K" | jq '{coupon, usage: (.usage | length), orders: (.orders | length)}'

# write one — idempotent on the code, which is stored upper-case
curl -s -X POST $A/admin/shop/coupons -H "$K" -H 'Content-Type: application/json' -d '{
  "code":"summer20","title":"20% off, up to ₹300","kind":"percent","value":20,
  "maxDiscount":30000,"minSubtotal":99900,"perUserLimit":2,"maxRedemptions":500
}' | jq '.created, .coupon.state'

# end a campaign: the till tests `active` first, so this stops it everywhere at once
curl -s -X PUT $A/admin/shop/coupons/SUMMER20/active -H "$K" -H 'Content-Type: application/json' \
  -d '{"active":false,"note":"campaign over"}' | jq '.coupon.state'

# and delete one that never ran
curl -s -X DELETE $A/admin/shop/coupons/SUMMER20 -H "$K" -H 'Content-Type: application/json' -d '{}' | jq
```

`state` is the till's own verdict, in the order `checkCoupon` tests things:
`inactive`, then `scheduled`, then `expired`, then `exhausted`, then `live`.
Which matters because an operator told "expired" would go and change a date
that would not help — a switched-off coupon reads `inactive`.

Three rules zod cannot state on its own, because each needs two fields, are
enforced on write and refused with the field named:

- a `percent` coupon over 100%;
- a `maxDiscount` on a `flat` one — the till applies it as well, so ₹200 off
  with a ₹50 cap is ₹50 off, which is a campaign nobody meant to run. A patch
  that switches `percent` → `flat` clears the stale cap rather than refusing;
- a window that closes before it opens, or a `maxRedemptions` already below
  what has been claimed (it would read as `exhausted` the moment it saved).

`redemptions` is the till's counter, not an operator's: checkout `$inc`s it
under a conditional write and a cancel gives it back, which is what holds the
ceiling when two orders race. Nothing here sets it. **Deleting is only for a
coupon nothing ever used** — one that has been redeemed is refused, because an
order holds its own `{code, title, discount}` snapshot and the usage rows are
what the per-member limit is counted from. The one tidy-up a delete does do is
clearing the code off any basket still holding it.

## Baskets and saved items (RULES R14)

```sh
# every basket with something in it, dearest first
curl -s "$A/admin/shop/baskets?sort=value" -H "$K" | jq '{totals, data: [.data[] | {member: .member.email, lines, units, value, blocked, offShelf, couponCode, stale, orderedSince}]}'
curl -s "$A/admin/shop/baskets?state=blocked" -H "$K" | jq '.data[].member.email'

# one member's, as stored and as they see it
curl -s "$A/admin/users/<userId>/basket" -H "$K" | jq '{basket, quote: {subtotal, coupon, payable}, wishlist: (.wishlist | length)}'

# take one line out, the coupon off, or the lot — a reason is required on each
curl -s -X DELETE $A/admin/users/<userId>/basket/lines -H "$K" -H 'Content-Type: application/json' \
  -d '{"itemId":"tee","size":"M","color":"Black","reason":"out of stock for a month"}' | jq '.basket.lines | length'
curl -s -X DELETE $A/admin/users/<userId>/basket/coupon -H "$K" -H 'Content-Type: application/json' -d '{"reason":"campaign ended"}' | jq
curl -s -X DELETE $A/admin/users/<userId>/basket -H "$K" -H 'Content-Type: application/json' -d '{"reason":"member asked on the phone"}' | jq
curl -s -X DELETE $A/admin/users/<userId>/wishlist/tee -H "$K" -H 'Content-Type: application/json' -d '{"reason":"duplicate"}' | jq

# and what people want, against what is on the shelf
curl -s "$A/admin/shop/demand?state=out_of_stock" -H "$K" | jq '[.data[] | {itemId, saved, inBaskets, units, onHand, short}]'
```

Every figure is at **today's** prices. A basket holds references, not
snapshots (RULES R14) — a price that changes while something sits in one is
the new price at checkout — so none of this is what the member saw when they
filled it.

**Two kinds of stuck, and only one of them lasts.** `getCart` drops a line
whose item is off the shelf and writes the drop back, so it clears itself the
next time the member opens their basket — and the admin read, which calls
`getCart` to quote the basket as they see it, clears it too. That is
`offShelf`: worth seeing, because it is what they meant to buy, but not a
repair. A line whose item is merely **out of stock** is kept and refused at
checkout with nothing on their screen to say which line is the problem. That
is `blocked`, and it is the one to act on.

`orderedSince` keeps the chasing honest: a basket whose owner went on to buy
something else is a shortlist, not an abandonment. And `demand` is the one
report sales figures cannot give — they can only ever show what was in stock.

The three cart writes go through the member's own `removeCartLine`,
`clearCart` and `removeCoupon`, so a basket an operator touched is left in
exactly the shape the app would have left it in.

## Reviews (RULES R15)

```sh
# worst first, which is the queue this exists for
curl -s "$A/admin/shop/reviews?sort=lowest&rating=1" -H "$K" | jq '{summary, data: [.data[] | {id, rating, body, verified, stillHoldsAnOrder, item: .item.id}]}'

# and take one down, which recounts the item
curl -s -X DELETE $A/admin/shop/reviews/rev_123 -H "$K" -H 'Content-Type: application/json' -d '{"reason":"abuse"}' | jq
# → {"deleted":true,"itemId":"tee","rating":{"average":5,"count":1}}
```

Deleting goes through commerce's own `recomputeItemRating`: `ratingAverage`
and `ratingCount` are denormalised onto the item so no list ever joins
`reviews`, and those are the figures every shop screen and every sort reads —
a delete that skipped the recount would leave a rating with nothing behind it.
The member can write another one; the unique index is on the pair, not on the
history.

`verified` is **not** re-decided here. It was set at write time from the
member's orders and is deliberately never revisited, so a review written after
buying stays a buyer's review even if the order was later refunded;
`stillHoldsAnOrder` is the live question beside it, for whoever is judging the
review.

## A badge by hand, and telling a segment

```sh
# unlocks one badge, through the same path the rules use — idempotent
curl -s -X POST $A/admin/users/<userId>/achievements -H "$K" -H 'Content-Type: application/json' \
  -d '{"achievementId":"steps-10k","reason":"goodwill after the outage"}' | jq

# how many a segment is, before anything is sent
curl -s "$A/admin/notifications/preview?platform=android&notSeenForDays=30" -H "$K" | jq

# and the send, which wants that count back
curl -s -X POST $A/admin/notifications/broadcast -H "$K" -H 'Content-Type: application/json' -d '{
  "segment": {"platform":"android"},
  "topic": "system",
  "title": "Scheduled maintenance",
  "message": "Vokve will be briefly unavailable tonight at 2am.",
  "expected": 412, "confirm": true, "reason": "planned downtime"
}' | jq
```

The badge goes through `unlockAchievement`, so it pays what the badge is worth
where ⚙ `coins.achievements.enabled` is on, tells the member, and granting one
they already hold does nothing. `via` records `admin:<actor>`, which is the
difference between a badge the rules gave and one support did. **A badge is
never taken back** — that is the rule, not a missing endpoint.

The broadcast is the one admin verb that cannot be undone, so it is built to
be hard to do by accident: the count comes from `preview` and goes back with
the send, and a segment that has moved by more than a tenth is **refused**
(`SEGMENT_MOVED`) rather than sent to. `confirm: true` and a reason are
required, 5,000 recipients is the ceiling on one call, and every message goes
through `notify()` — so a member who switched that category off gets the feed
row and no push, and the answer says how many that was. One send carries one
dedupe key, so pressing it twice cannot write two rows in anybody's feed.

### Reading the feed back, and taking a send back

```sh
# every notification in the window, with what became of it
curl -s "$A/admin/notifications?days=7&state=unread" -H "$K" | jq '{total, totals, byTopic}'
curl -s "$A/admin/notifications?q=asha@example.com" -H "$K" | jq '[.data[] | {topic, title, read, pushedAt, pushDeferredUntil}]'

# every broadcast, with the open rate the send could not know
curl -s "$A/admin/notifications/broadcasts" -H "$K" | jq '[.data[] | {title, sent, live, retractable}]'

# take back what can be taken back
curl -s -X POST "$A/admin/notifications/broadcasts/admin_broadcast:1792298779209/retract" -H "$K" \
  -H 'Content-Type: application/json' -d '{"reason":"the maintenance was called off","confirm":true}' | jq
# → {"retracted":true,"removed":5,"leftBecauseRead":1,"alreadyPushed":0}

# or one row out of one feed — which also cancels a push still being held
curl -s -X DELETE $A/admin/notifications/ntf_123 -H "$K" -H 'Content-Type: application/json' \
  -d '{"reason":"sent to the wrong segment"}' | jq
```

Three figures are worth knowing apart, because they are three different
things and only one of them is a failure:

- **read** is the only honest measure of a message nobody was pushed;
- **deferred** is a push quiet hours still hold — the one state with
  something left to happen in it, and the one thing deleting a row cancels;
- **notPushed** is a feed row with no push at all: the category was switched
  off, or no phone on the account could have shown one. That is consent
  working, not a delivery problem.

**A retraction is honest about its limits.** It deletes the rows nobody has
opened — which cancels any pending push with them — and leaves the ones
already read, because removing a message from a feed after somebody has read
it makes the member who asks about it look mistaken, and a push that has rung
cannot be unrung. Both counts come back.

The broadcast history is read from the audit log (`notifications.broadcast`)
joined to the notifications still carrying that send's `dedupeKey`: the audit
row is what was sent, the live rows are what became of it. No second
collection, and nothing to keep in step.

## Support, from the other side (RULES P12)

```sh
# the queue, ordered by who has been waiting longest for *us*
curl -s "$A/admin/support/tickets?waiting=us" -H "$K" | jq '{totals, byCategory, data: [.data[] | {reference, subject, status, waitingHours, lastFrom}]}'
curl -s "$A/admin/support/tickets?q=VK-7F3K" -H "$K" | jq '.data[0]'

# one ticket: the thread, the phone it was opened from, and their others
curl -s $A/admin/support/tickets/tkt_123 -H "$K" | jq '{ticket, member, otherTickets}'

# answer them — and set the state in the same write
curl -s -X POST $A/admin/support/tickets/tkt_123/replies -H "$K" -H 'Content-Type: application/json' \
  -d '{"message":"Your steps were held for review and have now been credited.","status":"resolved"}' | jq '.ticket.status, .notified'

# move it without saying anything in the thread
curl -s -X PUT $A/admin/support/tickets/tkt_123/status -H "$K" -H 'Content-Type: application/json' \
  -d '{"status":"in_progress","note":"picked up"}' | jq '.ticket.status'

# and delete spam — refused once support has replied
curl -s -X DELETE $A/admin/support/tickets/tkt_spam -H "$K" -H 'Content-Type: application/json' \
  -d '{"reason":"spam","confirm":true}' | jq
```

The member's half of this was already built — they open a ticket, the phone's
own details ride along, they reply, they read the thread — and nobody could
answer them. Three things shape the half that was missing:

- **The queue is "who is waiting", not "what is open".** A ticket whose last
  message is the member's is ours; one where we answered last is waiting on
  them. `waitingOnUs` is computed from the thread rather than stored, so it
  cannot drift from what the thread says — which is also why that filter and
  the `waiting` sort are applied to the newest 500 rows the other filters
  matched, rather than in the database.
- **A reply tells them**, through `notify()`, so their own switches decide
  whether a push follows the feed row — and the answer says which it was
  (`"notified": {"status":"created","push":"category_off"}`). Answering an
  `open` ticket also moves it to `in_progress`, because leaving it open would
  have the queue claiming nobody has looked.
- **Closing is the end.** The member's own reply route refuses a closed
  ticket (`TICKET_CLOSED`) and tells them to open a new one, so a reply from
  here is refused on a closed ticket too rather than quietly reopening a
  conversation they cannot take part in.

**Deleting is for a row that should never have been a ticket** — spam, a
duplicate. One support has replied to is refused (422): that would take away
the member's own copy of what we told them, and closing it keeps the thread
where they can still read it.

## The help centre's own content (RULES P12)

```sh
# articles, with the shelves they are filed under and the empty ones
curl -s "$A/admin/support/faqs?state=any" -H "$K" | jq '{totals, byCategory, data: [.data[] | {id, category, question, active}]}'

# write one — members read it at once, with no release
curl -s -X POST $A/admin/support/faqs -H "$K" -H 'Content-Type: application/json' -d '{
  "id":"how-coins-expire","category":"coins","question":"Do my coins expire?",
  "answer":"Coins expire 180 days after they are earned. The oldest are always spent first.",
  "tags":["expiry","validity"],"sort":1
}' | jq '.created, .article.active'

# hide it, or delete it
curl -s -X PUT $A/admin/support/faqs/how-coins-expire -H "$K" -H 'Content-Type: application/json' -d '{"active":false}' | jq '.article.active'
curl -s -X DELETE $A/admin/support/faqs/how-coins-expire -H "$K" -H 'Content-Type: application/json' -d '{}' | jq

# the app guide, chapter by chapter
curl -s $A/admin/support/guide -H "$K" | jq '{icons, tints, totals}'
curl -s -X POST $A/admin/support/guide -H "$K" -H 'Content-Type: application/json' -d '{
  "id":"first-steps","title":"Your first walk","summary":"Where the steps come from.",
  "icon":"guide","tint":"success",
  "steps":[{"title":"Allow activity access","body":"VOKVE counts with the phone own step sensor."}]
}' | jq '.created, .totals'
```

Both collections exist for one stated reason — *"so support can answer a wave
of the same question by writing one row, without waiting for an app
release"* — and the row could not be written. Two things that are not obvious
from the schema:

- **The app validates what it is given.** A guide chapter's `icon` and `tint`
  are parsed against the contract on read, so a name the app cannot draw does
  not leave a blank tile: it makes the *whole guide* fail to parse on the
  member's phone. Both are closed lists here for exactly that reason, and a
  chapter with no steps is refused as a heading pretending to be a chapter.
- **These really can be deleted.** Nothing holds a snapshot of an article —
  no order, no ticket, no basket points at one — so unlike a shop item there
  is nothing to break. `active: false` is for the one being drafted or
  withdrawn for a fortnight, and `emptyCategories` names the shelves with
  nothing active on them, because a help-page row (⚙ `support.topics`) that
  opens an empty list is a tile leading nowhere.

## Every other config key

```sh
# every section: what is in force, what the code ships, and where they parted
curl -s $A/admin/config -H "$K" | jq '{totals, sections: [.sections[] | {section, overrides: (.overrides | length), alsoOnStepsPage}]}'

# write one key by its dotted path
curl -s -X PUT $A/admin/config -H "$K" -H 'Content-Type: application/json' \
  -d '{"set":{"commerce.shippingFeePaise":9900,"support.hours":null},"note":"courier rates went up"}' | jq '.totals'

# and put it back to what the code ships
curl -s -X PUT $A/admin/config -H "$K" -H 'Content-Type: application/json' \
  -d '{"reset":["commerce.shippingFeePaise"]}' | jq '.totals'
```

`/admin/config/steps` above is the step pipeline's own surface: a curated,
hand-written schema, field by field, because those are the knobs most often
turned. This is the rest of the file — commerce, hydration, the streak, the
health ranges, nutrition, the leaderboard, challenges, OTP, devices,
integrity, the account's grace periods, the help centre's copy, the locale —
and writing a second hand-made schema for all of it would be a copy of the
defaults that drifts from them the first time somebody adds a key.

So a patch here is **validated against the shape of the defaults**, which
cannot drift because it *is* the defaults:

- a path that does not exist in `CONFIG_DEFAULTS` is refused, so a typo is a
  422 rather than a stray key `deepMerge` would happily add
  (`"commerce.shippingFeePiase": "There is no such config key."`);
- a value whose *kind* differs from the default's is refused — `"9900"` for a
  number, `1` for a boolean, an object where a list lives;
- inside a list of objects, a key the default's own elements do not have is
  refused, which is what keeps ⚙ `support.topics` honest — an unknown key
  there is a blank tile on a member's help page;
- `null` is allowed only where it means something: a key the code already
  ships as null, or one of the seven in `NULLABLE` (no phone on the help
  page, no tracking link on an order). Those are the `| null` annotations in
  `defaults.ts`, which are types and therefore gone by the time this runs;
- and then the merged config goes through `assertConfigValid` — the same
  cross-field validator every read runs — before anything is written, so the
  ladder rules still hold and the operator gets the sentence
  (`"hydration: 99999–8000 ml is not a range a drink can be in"`).

Writes are `$set` on dotted paths so two operators turning two knobs do not
overwrite each other, `reset` is `$unset` (the code's default, not the
previous value), and the cache is invalidated at once — a member's next
request reads the new value. `app.minVersion` is **refused** here and points
at the Releases surface, which checks that the store actually has a build to
send members to (`NO_BUILD_TO_UPDATE_TO`) — that check is the point of it.

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

`modules/notifications` is the feed (`GET /notifications`, `/counts`, read endpoints) and `notify()` is how anything tells a user something: feed row first, then a push if the topic's category switch is on, deferred to the end of quiet hours in the user's zone. Push goes out over FCM once the service account is in the environment — `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, see `.env.example`; without it `lib/push.ts` logs `push.no_provider` and the feed row is the only channel. Two kinds go out: an ordinary message, which carries `android.notification.channelId: 'vokve.default'` — the id the app creates at launch and names in `firebase.json`, so do not change it on one side alone — and a **silent** data-only message (`{ silent: true }`), which carries no notification block at all so the OS shows nothing and hands it to the app's background handler instead (RULES A28). The app registers its token with `PATCH /devices/:id { pushToken }` after sign-in and withdraws it on sign-out.

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
