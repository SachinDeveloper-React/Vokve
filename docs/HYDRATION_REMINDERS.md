# Hydration reminders — setup and how it works

For whoever builds this app next. Everything in JavaScript is done; iOS needs
one manual step in Xcode (§2) before a custom reminder sound will play there.

RULES §Y5–Y7 is the spec. This is the practical half: what to run, what to
add to the native projects, how a reminder gets from a time the member taps
to a notification on their phone, and how to check it.

---

## 1. What was added

| Where | What |
|---|---|
| `@notifee/react-native` | Local scheduled notifications. New dependency — `npm install` and, for iOS, `bundle exec pod install`. |
| `src/services/reminderSchedule.ts` | Pure: a plan + "now" → the alarms to schedule. No native calls, so every edge case is testable. |
| `src/services/notifications.ts` | The notifee side: channels, permission, scheduling, the sound preview, the tap handler. |
| `src/services/reminderScheduler.ts` | Watches the stores and keeps the OS in step. Started once, from `RootNavigator`. |
| `src/screens/main/ReminderSoundScreen.tsx` | The sound picker, reached from the reminder plan's settings card. |
| `android/app/src/main/res/raw/*.wav` | The three bundled sounds. |
| `ios/vokve/Sounds/*.wav` | The same three, **not yet in the Xcode target** — see §2. |
| `vokve-backend/src/modules/hydration/reminders.job.ts` | The server's minute sweep: the feed row, and the push where no phone is ringing. |
| `src/services/remindersDebug.ts` | The diagnostic below — why a reminder did or did not arrive, to the console. |

---

## 2. iOS: add the sounds to the target (one time)

iOS reads a notification sound from the app bundle at the moment it rings, so
the files have to be *in the target*, not merely in the repo. Copying them in
is the one step that cannot be done from here.

1. Open `ios/vokve.xcworkspace` in Xcode.
2. Drag `ios/vokve/Sounds` onto the **vokve** group in the project navigator.
3. In the dialog: **Create groups**, tick the **vokve** target, and leave
   "Copy items if needed" unticked — the files are already in place.
4. Check **Build Phases → Copy Bundle Resources** lists `water_drop.wav`,
   `chime.wav` and `bell.wav`.

Until that is done, iOS falls back to the system notification sound: the
reminder still arrives, it just does not play the chosen sound. Android needs
nothing — `res/raw` is compiled in by Gradle.

To add a fourth sound later: drop `<id>.wav` into both places, add the id to
`BUNDLED` in `src/constants/reminderSounds.ts`, and add it to
`hydration.sounds` in the backend config. iOS wants aiff/wav/caf under 30
seconds; Android wants a lowercase resource name with no dashes.

The three files are generated, not recorded — `water_drop` is a pitch-falling
plink, `chime` two decaying notes, `bell` a struck bell with inharmonic
partials. Replace them with anything you prefer at the same names.

---

## 3. Android: nothing to declare

Notifee's own manifest is merged into the app's and brings `VIBRATE`,
`SCHEDULE_EXACT_ALARM`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED` and the receiver
that re-schedules alarms after a restart — which is why a phone rebooted
overnight still rings at seven. The app's manifest says so in a comment and
repeats none of them.

`USE_EXACT_ALARM` is deliberately **not** declared. It would grant exact
alarms without asking, but Play only permits it for apps whose main purpose is
alarms or calendars, and a hydration reminder is not that. The app asks for
`SCHEDULE_EXACT_ALARM` instead, falls back to inexact alarms if refused, and
says so on the reminder screen.

---

## 4. How a reminder actually arrives

**The phone rings it.** A local alarm fires on the minute, with no network,
carrying the member's chosen sound. A push can promise none of the three: FCM
batches in Doze, a plane turns it off, and the sound belongs to a channel the
server does not own.

```
HydrationReminderScreen  →  remindersStore  →  PUT /hydration/reminders
                                  │
                       reminderScheduler (watches)
                                  │
                       planReminderAlarms(plan, now, quietHours)
                                  │
                       notifee.createTriggerNotification × n
                                  │
                       PATCH /devices/:id { localReminders: true }
                                  │
                       server: feed row only, no push
```

**What gets scheduled.** One alarm per *time*, not per reminder — a plan
holding 10:00 in the morning block and 10:00 as a custom time rings once,
because the member asked to be reminded at ten, not twice at ten. A plan that
runs all week gets one daily-repeating alarm per time; a plan on some days
gets one weekly-repeating alarm per day-and-time. Nearest first, up to a
budget (iOS keeps 64 pending requests per app and silently drops the rest, so
the budget is 56); the far end of a very large plan comes back into range as
the app re-syncs. Times inside quiet hours are not scheduled at all.

**The server's part.** It owns the plan, and it is the fallback. Its minute
sweep writes the notification-centre row for every due reminder either way,
and pushes **only** when no live install of the account has claimed local
scheduling in the last `hydration.localScheduleTrustDays` days — so a member
who refused the permission, or who signed in on a second phone and never
opens it, is still reminded, and nobody is reminded twice.

**Sound and vibration.** Android freezes a channel's sound and vibration when
the channel is created, by design — they belong to the user from then on. So
both are *in the channel id* (`vokve.hydration.<sound>.<buzz|quiet>`):
choosing a new sound makes a new channel and the stale ones are deleted on the
way past. On iOS the sound is a field on each notification, and vibration
follows the sound — iOS vibrates for a notification that makes one — so the
Vibration switch governs Android. The sound picker says so.

**Repeat days** are Monday-first (`0 = Monday`), matching `REPEAT_DAYS` and the
day letters on the screen, on both sides of the wire.

---

## 5. Checking it on a device

1. Open **Hydration → Reminder**. If the card under the master switch says
   health notifications are off, tap **Turn on** — they default to off
   (RULES Y6), and nothing is scheduled while they are.
2. Add a custom time two minutes out, and wait. It should arrive on the
   minute with the chosen sound.
3. Turn airplane mode on and add another two minutes out. It should still
   arrive — that is the point of the local alarm.
4. **Reminder Sound**: every row's play button rings that sound now.
5. Reboot the phone with a reminder pending; it should still ring.
6. Tap a reminder. It should open the water log, from a cold start too.

Server side, with the API running:

```sh
cd vokve-backend
npx vitest run test/hydrationReminders.test.ts
```

The sweep is wired into the scheduler's minute tick, so a plan due at the
current minute is swept within a minute of the process starting.

### When nothing arrives

**Read the report first.** Opening the reminder screen writes a diagnostic to
the console (`services/remindersDebug`, dev builds with ⚙
`config.logReminderSchedule` on — both default to yes). It shows in React
Native DevTools' console (`j` in Metro) and in `adb logcat -s ReactNativeJS`,
under `reminders:debug`. It prints the whole chain in order and points at the
break:

```
── Can a reminder arrive? ───────────────────
OS permission:     authorized
exact alarms:      DISABLED (reminders will be batched)
health category:   no  ← OFF: nothing is scheduled (RULES Y6)
plan enabled:      yes
quiet hours:       22:00–07:00
…
── What should be scheduled ───────────────
0 alarm(s), budget 56
→ Nothing, with a plan that is on. One of: health category
  off, no repeat days, every time switched off, or every
  time inside quiet hours.
```

The two that catch everybody, both of them working as specified and both now
said out loud on the screen:

1. **Quiet hours.** On by default, **22:00–07:00**. A time inside the window
   is dropped, not deferred (RULES Y6) — which means an evening test never
   rings. The screen now warns the moment such a time is added, and the card
   under the master switch counts them. Change the window in **Notification
   settings**.
2. **The health category.** Off by default (it is the one category about the
   member's body), and nothing is scheduled while it is. The card offers it
   in one tap.

Then:

- The OS permission, and exact alarms on Android 12+ — both on the same card.
- A channel **blocked** in Android's own notification settings silences every
  reminder and nothing in the app can see it; the report prints `blocked=yes`.
- A channel this phone refuses falls back to `vokve.hydration.fallback` (the
  default sound) rather than losing the plan — the report says so when that
  has happened. `VIBRATION_PATTERN` must be an even number of values, every
  one above zero: Android's convention of a leading `0` is what notifee
  rejects, and `createChannel` throwing used to leave everything unscheduled.
  `reminderNotifications.test` runs notifee's own validators over the exact
  channel and notification objects the app builds, so that cannot recur.
- Chinese-OEM builds (Xiaomi, Oppo, Vivo, Huawei) kill background alarms
  unless the app is whitelisted. Notifee can open those pages
  (`getPowerManagerInfo`, `openPowerManagerSettings`) if that turns out to
  be worth adding.
- `adb shell dumpsys alarm | grep vokve` lists what AlarmManager is holding.

### When the sound preview is silent

`previewReminderSound` returns `played | not_permitted | failed`, and the
picker says which — silence is never left to speak for itself, because it
could be the sound, the volume, the permission or a bug. If it says it
played and you still heard nothing:

- The phone's **notification** volume (not media), and Do Not Disturb.
- On iOS, §2 — a sound not in the Xcode target plays nothing at all.
- On Android, the report's channel section prints the sound each channel
  actually carries (`sound=water_drop`). `sound=none` on a channel that
  should have one means the raw resource did not resolve.

---

## 6. Not done

- **A "log a glass" action on the notification.** Notifee supports it; acting
  on it needs an authenticated write from a headless JS context, which is a
  piece of work of its own.
- **Per-reminder sounds.** The plan carries one sound for the whole plan,
  which is what the design asks for.
- **Snooze.**
- **The preset "View all" screen**, still a no-op on the reminder plan.
