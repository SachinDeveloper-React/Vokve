# Over-the-air updates (D-111)

The app's JavaScript and images can be updated without a store release, through
[Hot Updater](https://hot-updater.dev) on the app's own Firebase project. Native
code — a new or upgraded native package, permissions, `AndroidManifest.xml`,
`Info.plist`, React Native itself — still needs a store release.

## What is in the code

| Piece | Where |
|---|---|
| CLI config (Firebase storage + database, `fingerprint` strategy) | `hot-updater.config.ts` |
| Native interface hash every release build embeds | `fingerprint.json` (committed) |
| Release builds load the downloaded bundle | `android/app/src/main/java/com/vokve/MainApplication.kt`, `ios/vokve/AppDelegate.swift` |
| The updater, and which update is running | `src/services/otaUpdates.ts` |
| Checks on launch and every return to the app (at most every 15 min) | `src/hooks/useOtaUpdates.ts` |
| Server URL and client key (null = OTA off) | `src/constants/config.ts` → `otaBaseUrl`, `otaApiKey` |
| Running update reported to the API | `X-Vokve-Ota-Update` header → device `app.otaUpdate` → panel, member → Installs → "OTA update" |

An ordinary update downloads in the background and is used from the **next
launch**. A forced one (`-f`) reloads the app as soon as it has downloaded. A
bundle that cannot get the app to its first screen is rolled back on the next
launch by the native side, automatically.

## One-time setup (owner)

**Status (2026-11-24): steps 1–3 done.** Firestore `(default)` and the bucket
`vokve-d50ff.firebasestorage.app` are in `asia-south1`; the Function is
`https://hot-updater-v1-tijxznskfa-el.a.run.app` (doctor: all checks passed);
the deploy credentials are the service-account file
`firebase-adminsdk-credentials.json` in the app folder (git-ignored), named in
`.env.hotupdater`. Step 4 — the first store release with OTA on — is next.

Before deploying from another machine: copy `.env.hotupdater` and the
service-account file there privately (never through git), and never run
`hot-updater` with `sudo` — it leaves root-owned files that break every later
command.

Needs Node 22.23.4+, 24.22.1+ or 26.12.1+, the Google Cloud CLI (`gcloud`) and
the Firebase CLI, signed in to the account that owns the Firebase project. The
project must be on the Blaze plan (it already is, for phone sign-in).

1. In the app folder: `npx hot-updater init --provider firebase --build bare`
   - project: the app's Firebase project (`vokve-d50ff`), region close to members
     (e.g. `asia-south1`).
   - It creates Firestore/Storage entries and the managed Function, writes
     `.env.hotupdater` (git-ignored — keep it safe, it is how deploys are
     authorised) and rewrites `hot-updater.config.ts`. It keeps
     `updateStrategy: "fingerprint"` but drops the file's header comment, so
     put that back from git after a rerun.
2. Put the two values init prints into `src/constants/config.ts`:
   `otaBaseUrl` (the Function URL) and `otaApiKey` (`HOT_UPDATER_API_KEY`).
3. Check: `npx hot-updater doctor --server-base-url <otaBaseUrl>`.
4. Ship **one** normal store release of both apps with this code. Updates reach
   only builds made from here on.

## Shipping an update

```sh
npx hot-updater deploy -p android -m "Fix the step card"
npx hot-updater deploy -p ios -m "Fix the step card"
```

- Leave out `-p` to ship both platforms in one go.
- `-r 20` sends it to 20 % of phones first; raise it in the console.
- `-f` forces it: the app reloads as soon as it is downloaded. Only for a fix
  that cannot wait — a member loses whatever screen they were on.
- `npx hot-updater console` opens the dashboard: every bundle, rollout, rollback.
- Something wrong: `npx hot-updater bundle disable <id> -y` — phones go back to
  the previous bundle on their next check.

## When native code changes

`deploy` refuses with *Fingerprint mismatch* when the native side has changed
since `fingerprint.json` was made. That is the safety: a JavaScript bundle that
calls a native module an installed build does not have would crash on launch.

1. `npx hot-updater fingerprint create`, commit `fingerprint.json`.
2. Build and release through the stores as usual.
3. Updates deployed after that go only to the new builds; the old builds keep
   the updates made for them.
