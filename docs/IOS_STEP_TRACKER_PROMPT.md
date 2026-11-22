# Build `react-native-step-tracker-pro-ios`

You are building the iOS implementation of `react-native-step-tracker-pro`, a public npm package for React Native step tracking that is Android only today. The goal: an app that already uses it on Android counts steps on an iPhone **without changing its JavaScript** — same API, same return shapes, same events, and the same signed day snapshot (schema version 2) — so the app's server keeps verifying snapshots with the code it already has and only adds an Apple attestation check.

## Where things are

| What | Path |
|---|---|
| This package (an empty git repo) | `/Users/sachubhai/Documents/freelance/react-native-step-tracker-pro-ios` |
| The Android package — the contract | `/Users/sachubhai/Documents/freelance/react-native-step-tracker-pro` (v2.10.0) |
| Its public types: every shape you return | `src/types.ts` |
| Its JS layer: validation, error mapping, hooks — it will drive your module | `src/StepTracker.ts` |
| Its native spec: the TurboModule you implement | `src/NativeStepTrackerPro.ts` |
| Its behaviour | `android/src/main/java/com/steptrackerpro/**`, tests in `android/src/test/**` |

Read `src/types.ts`, `src/StepTracker.ts`, `docs/API.md` and `docs/ARCHITECTURE.md` in the Android package before designing anything.

## Rules

1. **The Android package is the contract.** Where this prompt does not settle a behaviour, read the Kotlin that implements it and do the same. Where iOS cannot, return the neutral value this prompt names and record the gap in `docs/IOS_DIFFERENCES.md`. Never invent data to fill a field.
2. **Same signed snapshot.** `schemaVersion: 2`, the same keys with the same meaning, the same signature format (§5). A server must parse and score an iOS snapshot with the code it uses for Android.
3. **Calories never come from HealthKit energy.** Do not read or request `activeEnergyBurned`, `basalEnergyBurned` or any other energy type. Apple's active energy adds non-walking activity (a watch counts a workout, a bike ride, stairs), so the same walk would show different calories on iPhone and Android. Every calorie figure (`StepSnapshot.calories`, `DayRecord.calories`, range stats) comes from the package's step formula, ported from `core/MetricsCalculator.kt`. `StepSource.calories` and `activeCalories` are `0` on iOS; `'totalCalories'` in `healthConnectReadTypes` is ignored on iOS and reported as not granted.
4. **Never write to HealthKit.** The iPhone already writes its own steps to Health; writing them again doubles them in every other app. `healthConnectWriteEnabled` is ignored on iOS, `writeHealthConnectSteps` resolves `false`, and no share permission is ever requested.
5. **Read only `stepCount` and `distanceWalkingRunning`.** App Review rejects HealthKit apps that ask for types they do not use.
6. **Generic and public.** No app names, URLs, bundle ids, thresholds or copy from any consumer in code, docs, tests or commit messages. Defaults must be sensible; behaviour is driven by the config keys the JS API already has.
7. **Additive only.** No new required JS method or field. Every type change is an optional field or a new union member (§2).
8. **Do not push or publish to npm.** Commit locally in logical steps; the owner reviews and publishes.

## 1. What a real consumer calls

A production app is the reference consumer (never name it anywhere). Make these work first, exactly as on Android, with the iOS behaviour in §6:

`initialize`, `updateConfig`, `getConfig`, `startTracking`, `pauseTracking`, `resumeTracking`, `stopTracking`, `getTrackingState`, `getTrackingHealth`, `getTodaySteps`, `getStepsForDate`, `setOtherDevicesSteps`, `setCountFrom`, `resetToday`, `clearHistory`, `checkPermissions`, `requestPermissions`, `getHealthConnectStatus`, `enableHealthConnect`, `requestHealthConnectPermissions`, `revokeHealthConnectPermissions`, `openHealthConnectSettings`, `openAppSettings`, `getBackgroundRestrictionStatus`, `requestBackgroundPermissions`, `getVerificationSnapshot`, `getSignedSnapshot`, `getIntegrityReport`, `getHealthConnectRecords`, `attestDevice`, `hasAttestationKey`, `requestIntegrityToken`, `prepareIntegrity`; events `stepsChanged`, `trackingStateChanged`, `dayChanged`, `historyBackfilled`, `stepSourceChanged`, `healthConnectStatusChanged`, `error`.

How it syncs, so you know what matters most: for each recent day it calls `getSignedSnapshot(date, { nonce, include: ['minutes', 'motionWindows', 'healthConnectRecords'], healthConnectRecordTypes })` and uploads only the returned signature block. The server verifies the signature with the public key from `attestDevice()`, then scores the day from the minutes, sources and records inside it. When the server wants a fresh device verdict, the app calls `requestIntegrityToken({ requestHash: signature.payloadSha256, cloudProjectNumber })`. Distance, calories and **active minutes are computed on the server** from the signed steps and minute buckets, so the minute buckets (§4) decide a user's active time and must be right.

## 2. Part A — a small change in the Android package (do this first)

In `/Users/sachubhai/Documents/freelance/react-native-step-tracker-pro`, as the next minor after 2.10.0, with tests and a CHANGELOG entry:

1. `src/StepTracker.ts`: `getNativeModule()`, `isSupported()` and `addListener()` gate on `Platform.OS !== 'android'`. Make them gate on "a native `StepTrackerPro` module is registered" instead. Android behaves as before; iOS **without** the companion stays exactly as inert as today (`isSupported()` false, `E_UNSUPPORTED_PLATFORM`, no-op subscriptions). Update the `LINKING_ERROR` text.
2. `requestIntegrityToken` / `prepareIntegrity`: `cloudProjectNumber` is a Play concept. Make it optional in `IntegrityTokenOptions` and assert it only when `Platform.OS === 'android'`.
3. `src/types.ts`, optional additions only:
   - `VerificationSnapshot.platform?: 'android' | 'ios'`, and Android starts emitting `'android'` (absent means Android).
   - `VerificationSnapshot.motionWindowsStatus` gains `'unsupported'`.
   - `DeviceCapabilities.platform?: 'android' | 'ios'` and `osVersion?: string`; the snapshot's `capabilities` Pick adds `'osVersion'`.
   - `DeviceAttestation.securityLevel` gains `'secure_enclave'`; `DeviceAttestation.appAttest?: { keyId: string; attestationObject: string; clientData: string; environment: 'development' | 'production' } | null` (`attestationObject` is base64 CBOR).
   - `IntegrityToken.provider?: 'play_integrity' | 'app_attest'`.
   - `DistanceSource` and `ResolvedStepSource.distanceSource` gain `'healthkit'`.
   - `HealthConnectStatus.provider?: 'health_connect' | 'healthkit'`, so an app can say "Apple Health" instead of "Health Connect".
   - `BackgroundRestrictionStatus.backgroundRefresh?: 'available' | 'denied' | 'restricted'`.
   - Document that on iOS `IntegrityErrorDetails.playErrorCode` is `null` and `playError` is `APP_ATTEST_<DCError case>`.
4. Do **not** change `src/NativeStepTrackerPro.ts`. Keep `ios: null` in `react-native.config.js`: this package still ships no iOS code.
5. README: iOS is supported by also installing `react-native-step-tracker-pro-ios`; drop "none is planned".

## 3. Architecture

- This package registers a native **TurboModule named `StepTrackerPro`** implementing the **exact codegen spec**, copied byte for byte from the Android package's `src/NativeStepTrackerPro.ts` into this package's `src/`. The Android package's JS finds it through `TurboModuleRegistry.get('StepTrackerPro')` and drives it, so its validation, error mapping and hooks are reused and nothing is duplicated. Add a test that fails when the copy differs from the peer dependency's file.
- `package.json`: name `react-native-step-tracker-pro-ios`; `codegenConfig: { name: 'RNStepTrackerProIOSSpec', type: 'modules', jsSrcsDir: 'src', ios: { modulesProvider: { StepTrackerPro: '<your ObjC class>' } } }`; peer dependencies `react-native-step-tracker-pro` (≥ the Part A version) and `react-native` (the Android package's floor, 0.77, if typed `EventEmitter` specs work there on iOS; otherwise the oldest that works). Test on React Native 0.87.
- `react-native.config.js`: `android: null`.
- New Architecture only. Emit events through the generated typed emitters (`emitOnStepsChanged:` and so on).
- An ObjC++ (`.mm`) class conforming to the generated `NativeStepTrackerProSpec`, delegating to Swift. Keep all pure logic (metrics, minute bucketing, fraud rules, source resolution, vehicle gate, snapshot building, JSON) in Swift files that import no HealthKit, CoreMotion or UIKit, and expose them as a Swift Package target too, so `swift test` runs on macOS without a simulator.
- Podspec: `install_modules_dependencies(s)`; frameworks HealthKit, CoreMotion, DeviceCheck, CryptoKit, Security; iOS 15.1. Ship a `PrivacyInfo.xcprivacy` in the pod declaring each required-reason API you use (UserDefaults, system boot time, file timestamps) with honest reasons.
- One serial queue or actor owns all state; HealthKit and CoreMotion callbacks hop onto it.

## 4. Counting model

| Android | iOS |
|---|---|
| Hardware step counter in a foreground service | CMPedometer. The motion coprocessor counts all the time, app running or not: no service, no notification, no gap recovery (`recoveredSteps` is always 0, `gapRecovery` is ignored) |
| Health Connect sources | HealthKit sources |
| Activity Recognition (vehicle, bicycle, still) | CMMotionActivityManager history |
| Keystore key + key attestation | Secure Enclave key + App Attest (§5) |
| Play Integrity token | App Attest assertion (§5) |
| Accelerometer motion windows | Not available: iOS gives no background accelerometer |

### This phone's own count (`deviceSteps`) and its minutes

- `deviceSteps` = CMPedometer for the day, cut by `countFrom` and the tracking spans below.
- Minute buckets (`StepMinute`) from CMPedometer history: query hours first, then each minute of the hours that have steps. On a device, verify that minute sums equal the hour and day totals. If per-minute history proves unreliable, use HealthKit `HKStatisticsCollectionQuery` (1-minute interval, cumulative sum) restricted to the iPhone's own built-in source (bundle id `com.apple.health.*`, product type `iPhone*`, `HKMetadataKeyWasUserEntered` not true). Document which one shipped and the measurements behind the choice.
- `sum(minutes) == deviceSteps - gatedSteps` must hold: the server flags a count its minutes do not explain.
- Per-minute steps are `steps` (timed). `untimedSteps` stays 0 unless you find a case where timing is truly unknown.
- CMPedometer and CMMotionActivity keep only 7 days. Persist each day's minutes and totals the first time it is computed after it closes, and recompute open days on every launch and background wake, so day 8 onward still gives the identical snapshot. A day older than 7 days that was never computed falls back to the HealthKit iPhone-source buckets with all tags 0, plus an integrity event `sensor_changed` with detail `{ from: 'pedometer', to: 'healthkit' }`.
- Tracking state mirrors Android: steps taken while tracking was paused or stopped are not this phone's count (persist those spans and cut them out), and on the install day `coverageStartAt` is the first `startTracking()`. `setCountFrom`, `resetToday`, `clearHistory`, `pruneHistory` and `setOtherDevicesSteps` follow the Kotlin (`health/CountFrom.kt` and the rest).
- `sensor: 'step_counter'`. `minutesStatus` follows `fraudDetection.enabled`, as on Android.

### Vehicle gate, still and charging tags

Mirror the contract of `core/VehicleGate.kt` and `core/StepTimeline.kt`:

- A minute is a *vehicle* minute when a CMMotionActivity covering it has `automotive` or `cycling` with confidence ≥ medium and neither `walking` nor `running`. A *still* minute: `stationary` with confidence ≥ medium, not walking or running.
- `motionGate.enabled`: steps in vehicle minutes go to `gatedSteps`. They stay in raw `deviceSteps` and are out of every minute and out of `resolved`, exactly the Android contract. `vehicleSteps` tags only vehicle-minute steps that were not gated (gate off, or low confidence). `stillSteps` tags still minutes.
- `chargingSteps`: only for spans in which the package itself saw the phone charging (UIDevice battery notifications while the process was alive); otherwise 0. Document it.
- Fill `integrity.activityRecognition` and `integrity.motionGate` from CMMotionActivity: `current` ∈ still / walking / running / on_bicycle / in_vehicle / unknown; `verdict` ∈ gait / vibration / still / unknown.

### Integrity checks

Port `core/FraudDetector.kt`: `cadence`, `steady_cadence`, `continuous`, `night`, `daily_volume`, `in_vehicle`, `activity_still`, and `charging` where spans exist (`shake` and `swing` need motion windows and never fire on iOS). Use the same thresholds from config, the same `suspectSteps`, and the same `mode: 'flag' | 'exclude'` behaviour.

Port the Android test vectors to Swift — `FraudDetectorTest.kt`, `StepTimelineTest.kt`, `VehicleGateTest.kt`, `StepSourceResolverTest.kt`, `CountFromTest.kt`, `OtherDevicesTest.kt`, `HourlyStepsTest.kt`. Identical inputs, identical outputs.

Device hints (`integrity.device`): `emulator` = simulator; `suBinary` = jailbreak indicators (document what is checked; cheap checks only, no private APIs); `appDebuggable` = debugger attached or a debug build; `testKeysBuild`, `adbEnabled`, `developerOptions` = false; `stepCounter` = `{ name: 'CMPedometer', vendor: 'Apple', version: 0, wakeUp: true }`.

### HealthKit sources (`sources`, `sourcesStatus`, `resolved`)

- One `StepSource` per HealthKit source with steps that day (statistics separated by source), with `hourlySteps` (24 local hours) and `distance` from that source's `distanceWalkingRunning` (`distanceSource: 'healthkit'`).
- The iPhone's built-in source: `kind: 'phone'`, `isPlatform: true`. Apple Watch (bundle `com.apple.health.*`, product type `Watch*`): `kind: 'watch'`, and `isWearable`, `trustedWearable`, `isPlatform` all true.
- Third-party apps: `kind` from the samples' `HKDevice` when present, else `'app'`. `trustedWearable` per `wearableTrust`: `'metadata'` trusts samples whose device says watch, band or ring; `'catalog'` trusts bundle ids in this package's iOS catalog or in `wearableAllowlist`. Put only bundle ids you verified (official documentation, or seen as a HealthKit source on a device) in the catalog; list unverified candidates in the docs instead.
- `manualSteps` = steps from samples with `HKMetadataKeyWasUserEntered == true`, kept out of resolution as Android does when `healthConnectIgnoreManualEntries` is on. Fill the `recordingMethods` breakdown. `unknownMethodSteps` = third-party samples with no device. `lateWrittenSteps: -1` (HealthKit exposes no write time). `isSelf: false` (this package never writes).
- `sourcesStatus`: `'read'`, `'not_consulted'` (`healthConnectEnabled` false, or `stepSource: 'device'`), `'timed_out'`, or `'failed'` (including a locked device).
- `resolved`: port `health/StepSourceResolver.kt` unchanged and feed it these inputs. `countFrom` cuts sources the way Android cuts Health Connect records: each sample counts for its share after it.

### Records (`include: ['healthConnectRecords']`, `getHealthConnectRecords`)

HealthKit samples of the asked types, mapped to `HealthConnectRecord` / `HealthConnectDistanceRecord`:

- `id` = the sample UUID; `clientRecordId` = `HKMetadataKeySyncIdentifier` or null; `clientRecordVersion` = `HKMetadataKeySyncVersion` or 0; `packageName` = the source's bundle id.
- `recordingMethod`: `'manual'` when user-entered, `'automatic'` for Apple's built-in sources or samples with a device, else `'unknown'`.
- `device` from `HKDevice` (`'watch'`, `'phone'` or `'unknown'`, plus manufacturer and model), or null.
- Times in epoch ms; zone offsets from `HKMetadataKeyTimeZone`, or null; `lastModifiedTime: 0`.
- At most 10,000 per type, with `truncated`; `status` as the type documents.

### Motion windows

`include: ['motionWindows']` returns `motionWindows: []` and `motionWindowsStatus: 'unsupported'`. `getMotionWindows` resolves `[]`. `motionSampling` is accepted and ignored, and `motionWindow` never fires.

## 5. The signed snapshot, attestation and integrity

### Snapshot fields

iOS values; anything not listed is as on Android:

- `schemaVersion: 2`; `libraryVersion`: this package's version; `platform: 'ios'`; `date` in the device zone.
- `deviceSteps`, `recoveredSteps: 0`, `gatedSteps`, `sensor: 'step_counter'`, `coverageStartAt`, `countFrom`, `otherDevicesSteps`.
- `sources`, `sourcesStatus`, `resolved` as in §4.
- `capabilities: { hasStepCounter: CMPedometer.isStepCountingAvailable(), hasStepDetector: false, manufacturer: 'Apple', model: <sysctl hw.machine, e.g. 'iPhone15,2'>, sdkInt: 0, osVersion }`.
- `health: { recoveryCount: 0, lastRecoveryReason: null, batteryOptimizationEnabled: false, aggressiveOem: false }`.
- `clock: { wallClockMs, bootId: <boot time from sysctl kern.boottime, epoch ms>, timezone: <IANA id>, utcOffsetMinutes }`.
- `suspectSteps`, `integrity`, `include`, `minutes`/`minutesStatus`, `motionWindows`/`motionWindowsStatus`, `healthConnectRecords`, `nonce`, `signedAt`, `signature`.

### Bytes and signature

These are identical to Android, so the server's verifier needs no change:

- `signedPayload` = the snapshot without `signature`, as UTF-8 JSON: integers as integers, no NaN or Infinity, no keys with undefined values.
- `payloadSha256` = lowercase hex SHA-256 of those bytes.
- `value` = base64 DER ECDSA P-256 signature over those bytes. Use `SecKeyCreateSignature` with `.ecdsaSignatureMessageX962SHA256`, which matches Java's `SHA256withECDSA`.
- `algorithm: 'SHA256withECDSA'`; `keyId` = the signing key's id; `attested` as for the key.
- `getSignedSnapshot` (native option `signedOnly`) returns only the signature block, as on Android.
- Tests:
  - Build an iOS snapshot from fixtures and check that its key set equals an Android snapshot's for the same options (plus `platform`).
  - Add a Node script in `scripts/` that verifies a signature with the public key using `node:crypto`, the way a server would.

### `attestDevice(challenge)`

1. Delete this package's previous keys. Create a P-256 private key in the Secure Enclave: permanent, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (so background signing works), no user-presence flag. `publicKey` = base64 X.509 SubjectPublicKeyInfo DER: the 26-byte P-256 SPKI header followed by the 65-byte X9.63 point. `keyId` = lowercase hex SHA-256 of the SPKI DER, the same derivation as Android.
2. If `DCAppAttestService.shared.isSupported`:
   - Call `generateKey()`.
   - Call `attestKey(appAttestKeyId, clientDataHash: SHA256(UTF8(challenge + "|" + keyId)))`.
   - Return `appAttest: { keyId: appAttestKeyId, attestationObject: <base64>, clientData: challenge + "|" + keyId, environment }`, with `attested: true` and `securityLevel: 'secure_enclave'`.

   This binds the signing key to a genuine install of the app, so a server trusts `publicKey` exactly as it trusts an attested Android key.
3. When App Attest is not supported (simulator, unsupported device), still make the key: in the Secure Enclave if there is one, else a software Keychain key with `securityLevel: 'software'`. Return `attested: false` and `appAttest: null`, which is Android's unattested fallback. A transient App Attest failure (`DCError.serverUnavailable`) does not downgrade: it rejects `E_INTEGRITY_FAILED` with `retryable: true`.
4. `certificateChain: []`, `algorithm: 'SHA256withECDSA'`, `createdAt`, `createdBy: 'attestDevice'`. Log the `device_attested` event. Keep the attestation object and client data, so `getAttestationKeyInfo()` can return them again.

Signing before any `attestDevice()` makes an unattested key with `createdBy: 'sign'`, and `hasAttestationKey()` stays false, as in Android 2.3+.

Keychain items survive an uninstall on iOS, while Android keys do not. On the first launch of a fresh install (detected by a missing UserDefaults marker), delete this package's leftover Keychain items and App Attest key id.

### `requestIntegrityToken({ requestHash })`

Returns an App Attest assertion:

- Call `generateAssertion(appAttestKeyId, clientDataHash: SHA256(UTF8(requestHash)))` and resolve `{ token: <base64 assertion>, requestHash, provider: 'app_attest' }`.
- No App Attest key: reject `E_INTEGRITY_UNAVAILABLE`.
- A `DCError`: reject `E_INTEGRITY_FAILED` with `details: { playErrorCode: null, playError: 'APP_ATTEST_<CASE>', retryable }`. `serverUnavailable` is retryable; `invalidKey` is not, because the app has to attest again.

`prepareIntegrity` resolves at once.

### `docs/SERVER_VERIFICATION_IOS.md`

What a server checks, following Apple's "Validating apps that connect to your server", with a small Node reference implementation.

Attestation:
- The `x5c` chain leads to the Apple App Attestation Root CA.
- `nonce = SHA256(authData ‖ SHA256(clientData))` equals the credential certificate's extension `1.2.840.113635.100.8.2`.
- SHA-256 of the credential certificate's public key equals `appAttest.keyId` and the credential id in the authenticator data.
- `rpIdHash = SHA256("<TeamID>.<bundleId>")`.
- The counter is 0.
- The aaguid is `appattestdevelop`, or `appattest` followed by seven zero bytes, per environment.
- `clientData` is `challenge|keyId`, with the challenge the server issued and `keyId = SHA256(publicKey)`.

Assertion:
- It is CBOR `{ signature, authenticatorData }`.
- `nonce = SHA256(authenticatorData ‖ SHA256(UTF8(requestHash)))`.
- The signature is valid under the credential public key.
- `rpIdHash` matches.
- The counter is strictly greater than the stored one.

## 6. Every other method on iOS

Store the config exactly as given and return it from `getConfig()`, so `updateConfig` / `getConfig` round-trip as on Android. Keys iOS does not use are kept, not dropped. Stride, distance, calories and goal progress use the ported `MetricsCalculator` with the stored height, weight and sex.

| Method | On iOS |
|---|---|
| `checkPermissions` | `activityRecognition` = Motion & Fitness authorised; `postNotifications` and `foregroundServiceHealth` true (nothing to grant on iOS); `allGranted` = `activityRecognition` |
| `requestPermissions` | CoreMotion has no request call. Run a tiny CMPedometer query to raise the system prompt, then resolve with the status after the answer |
| `startTracking` | Needs Motion & Fitness (`E_PERMISSION_DENIED`) and a pedometer (`E_NO_SENSOR`). Starts live pedometer updates while in the foreground plus background delivery (§7). State `'running'` |
| `pauseTracking`, `resumeTracking`, `stopTracking`, `getTrackingState`, `isTracking` | As Android; paused and stopped spans are cut from this phone's count |
| `getTrackingHealth` | `serviceAlive` = tracking is running; `looksDead: false`; `recoveryCount: 0`; heartbeat = the last time the package read the pedometer; `batteryOptimizationEnabled` and `aggressiveOem` false; `manufacturer: 'Apple'` |
| `getDeviceCapabilities` | `hasStepCounter` = pedometer available; `hasStepDetector` and `hasWakeUpAccelerometer` false; `hasAccelerometer` true; `bestSensor: 'step_counter'`; `sdkInt: 0`; `platform: 'ios'`; `osVersion`; `manufacturer: 'Apple'`; `model` = hw.machine |
| `getBackgroundRestrictionStatus` | Every Android flag false or null; `manufacturer` and `brand` `'Apple'`; `backgroundRefresh` from `UIApplication.backgroundRefreshStatus` |
| `isBatteryOptimizationEnabled`, `requestDisableBatteryOptimization`, `openBatteryOptimizationSettings`, `openManufacturerAutoStartSettings` | `false`, so `requestBackgroundPermissions()` resolves `'none'` without opening anything |
| `openAppSettings` | The app's page in Settings |
| `getHealthConnectStatus` | See the paragraph below this table |
| `enableHealthConnect`, `requestHealthConnectPermissions` | `HKHealthStore.requestAuthorization(toShare: [], read: <asked types>)`, then the status |
| `openHealthConnectSettings` | Opens the Health app (`x-apple-health://`), else the app's Settings page; resolves whether anything opened |
| `installHealthConnect`, `revokeHealthConnectPermissions`, `writeHealthConnectSteps` | `false`. iOS has no revoke API; document that the user revokes in Health → Sharing |
| `readHealthConnectSteps`, `getHealthConnectRecords` | HealthKit, in the shapes from §4 |
| `getHealthConnectChangesToken`, `getHealthConnectChanges` | `HKAnchoredObjectQuery`; the token is the anchor, archived to base64 |
| `readHealthConnectVitals` | An empty result, every type not granted (no vitals on iOS in v1) |
| `deleteHealthConnectData` | Nothing was written, so nothing is deleted: a zero result |
| `syncWithHealthConnect` | Re-reads the day's sources; the same `SyncEvent` shape |
| `getStepSources`, `getCurrentStepSource`, `setPreferredStepSource` | HealthKit sources, with bundle ids where Android uses package names |
| `getInstalledCompanionApps` | `[]` (iOS cannot list installed apps) |
| `getStepsForDate`, `getYesterdaySteps`, `getHistory`, `getStatsForRange`, `getWeeklyStats`, `getMonthlyStats`, `getYearlyStats` | From persisted days and HealthKit, with Android's shapes and range math; `synced` and `syncedRemote` false |
| `syncNow`, `getSyncStatus`, `getPendingSyncCount` (remote sync) | Not in v1: `[]`, a disabled status, `0`. Document it |

`getHealthConnectStatus` on iOS:
- `provider: 'healthkit'`.
- `available` and `availability` from `HKHealthStore.isHealthDataAvailable()`: `'available'` or `'not_supported'`. `requiresUpdate` and `installable` false.
- Read grants per the rule below; `grantedReadTypes` ⊆ `['steps', 'distance']`.
- `canWrite` false; `grantedWriteTypes` `[]`.
- `backgroundReadAvailable`, `backgroundReadGranted`, `historyReadAvailable` and `historyReadGranted` are true once reads are granted, because iOS has no separate user grant for these.
- Permissions are named with HealthKit identifiers. `undeclaredPermissions` lists a missing Info.plist key or entitlement.
- `workProfile` false. Omit `rateLimit` and `deviceStepTracking`.

**iOS hides HealthKit read grants**: it never says whether a read was denied. Use `getRequestStatusForAuthorization` to learn that the sheet was answered, then infer: if CMPedometer has steps in the last 7 days but HealthKit returns no step samples from any source over the same span, report steps not granted (`stepsGranted: false`, `shouldOpenSettings: true`). Document the heuristic.

**Crash guards**: HealthKit and CoreMotion terminate the app when a usage string is missing. Before touching either, check for `NSHealthShareUsageDescription`, `NSMotionUsageDescription` and the HealthKit entitlement. If one is missing, reject (`E_HEALTH_CONNECT_NOT_DECLARED` / `E_PERMISSION_DENIED`) with a message naming the missing key.

## 7. Events, background and storage

Events:
- `stepsChanged`: live CMPedometer updates while the app is in the foreground and tracking, throttled by `eventThrottleMs`; also after background recomputation.
- `goalReached` and `goalProgressChanged`: the rules in `core/GoalTracker.kt`.
- `trackingStateChanged`.
- `dayChanged`: at local midnight and on clock or zone changes; also log `clock_changed` / `timezone_changed`.
- `historyBackfilled`: when HealthKit brings data for a past day, such as a watch syncing late.
- `stepSourceChanged`: when the resolved winner changes.
- `healthConnectStatusChanged`: when grants change (checked on each foreground).
- `suspiciousActivity`: from the fraud rules.
- `error`.
- Never fired on iOS: `motionWindow`, `syncCompleted`, `syncAuthFailed`.

Background:
- Register `HKObserverQuery` for the granted types on every process launch, before launch finishes. Do it from the module itself (`+load` plus `UIApplicationDidFinishLaunchingNotification`), so the app's AppDelegate needs no edit.
- Call `enableBackgroundDelivery(.hourly)`. Hourly is the most often iOS allows for steps, and it needs the `com.apple.developer.healthkit.background-delivery` entitlement.
- On a wake: recompute the affected days, persist them, emit events, and call the completion handler promptly.

Locked device: HealthKit cannot be read while the phone is locked. Never crash. Serve the last persisted values with `sourcesStatus: 'failed'`, and recompute on `protectedDataDidBecomeAvailable`.

Storage: Application Support, file protection `completeUntilFirstUserAuthentication`, retention per `historyRetentionDays`.

## 8. Docs to write

- `README.md`:
  - install and `pod install`;
  - Xcode capabilities: HealthKit with Background Delivery, and App Attest with its environment entitlement;
  - Info.plist keys `NSHealthShareUsageDescription` and `NSMotionUsageDescription`;
  - minimum iOS version.
- `docs/IOS_DIFFERENCES.md`: every method and field that differs from Android, and why.
- `docs/SERVER_VERIFICATION_IOS.md`: as specified in §5.
- `docs/APP_STORE.md`: HealthKit review notes; privacy label Health & Fitness; no energy types read, nothing written.
- `CHANGELOG.md`.
- An `example/` app with one screen showing permissions, today's count, minutes, sources, a signed snapshot and its verification.

## 9. Order of work, and when it is done

1. Part A in the Android repo, with tests.
2. Scaffold: the package, the spec copy and its check, codegen, and an ObjC++/Swift module whose every method resolves a neutral value. The example builds on a simulator and on a device.
3. The pure Swift ports, with the Android test vectors.
4. Pedometer and motion activity → minutes, gate, tags, persistence.
5. HealthKit sources, records, permissions.
6. Snapshot, signing, attestation, integrity token.
7. Events, background delivery, lock handling.
8. Docs and the device checklist.

**Done when:**
- With the Part A version of `react-native-step-tracker-pro` and this package installed, an app's unchanged JavaScript gets `isSupported() === true` on an iPhone, and every call in §1 works.
- No spec method crashes on iOS: each resolves the neutral value in §6 or rejects with a documented code.
- A signed snapshot:
  - verifies with `node:crypto` under the attested public key;
  - parses as `VerificationSnapshot`;
  - has the Android key set.
- The Swift tests pass, including the ported Android vectors.
- On a real iPhone:
  - A 500-step walk is within 2% of the iPhone figure in the Health app.
  - Minute sums equal `deviceSteps - gatedSteps`.
  - A car or bus ride shows up in `gatedSteps`.
  - A walk wearing an Apple Watch, with the phone left on a desk, resolves to the watch.
  - A manual entry in the Health app lands in `manualSteps` and not in `resolved`.
  - A background wake while the phone is locked does not crash.
  - After a reinstall, `hasAttestationKey()` is false.
  - The simulator runs without crashing and attests as unattested.

Report back with what shipped, every deviation from this prompt and why, the device results, and what is left.
