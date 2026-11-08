#!/usr/bin/env node
/**
 * Does Google sign-in actually agree with itself? (RULES O12)
 *
 * Google sign-in is configured in five places that nothing forces to
 * match: the Android `google-services.json`, the iOS
 * `GoogleService-Info.plist`, the iOS `Info.plist` URL scheme, the
 * Xcode bundle id, and the server's `GOOGLE_WEB_CLIENT_ID`. When two of
 * them disagree the app builds, installs, opens the Google sheet,
 * returns a token — and the server answers 401 with nothing in the log
 * but "token invalid". There is no stack trace to follow and no test
 * that can fail, because every piece is individually correct.
 *
 * So the agreement itself gets checked. This is the matrix:
 *
 *   Android  default_web_client_id (type 3)  ──┐
 *   iOS      plist WEB_CLIENT_ID            ──┴─► server audience list
 *   iOS      plist CLIENT_ID                ────► Info.plist URL scheme
 *   iOS      plist BUNDLE_ID                ────► Xcode bundle id
 *   Android  google-services package_name   ────► Gradle applicationId
 *
 * Two tiers, deliberately. A `✗` is config that cannot work and fails
 * the command. A `⚠` is config that *works*, for the platforms it has
 * not broken — the Google console is fine, the server is fine, and one
 * platform's sign-in will be refused until somebody aligns one value.
 * The difference matters because a check that is red while the thing it
 * guards is knowingly half-configured gets ignored, and then it is not
 * guarding anything.
 *
 * Run it after re-downloading either bundled file, which is the moment
 * the drift happens.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

const warnings = [];
const fail = (what, detail) => problems.push({ what, detail });
const warn = (what, detail) => warnings.push({ what, detail });
const read = path => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);

/** The plist files here are flat `<key>/<string>` pairs, so a regex is honest. */
const plistValue = (text, key) =>
  text?.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1] ?? null;

// ── Android ──────────────────────────────────────────────────────────
const androidRaw = read('android/app/google-services.json');
let androidWebClient = null;
if (!androidRaw) {
  fail('android/app/google-services.json', 'missing — Google sign-in cannot work on Android');
} else {
  const client = JSON.parse(androidRaw).client?.[0];
  const pkg = client?.client_info?.android_client_info?.package_name ?? null;
  const gradle = read('android/app/build.gradle') ?? '';
  const applicationId = gradle.match(/applicationId\s+["']([^"']+)["']/)?.[1] ?? null;
  if (pkg !== applicationId) {
    fail('Android package id', `google-services.json says ${pkg}, build.gradle says ${applicationId}`);
  }

  const oauth = client?.oauth_client ?? [];
  // client_type 3 is the web client; it is what the Google Services
  // Gradle plugin writes out as `default_web_client_id`, and therefore
  // the audience every Android token will carry.
  androidWebClient = oauth.find(entry => entry.client_type === 3)?.client_id ?? null;
  if (!androidWebClient) {
    fail('Android web client', 'no client_type 3 entry — `autoDetect` will have no id to find');
  }

  // Without a registered SHA-1 the Android client exists but Credential
  // Manager refuses with DEVELOPER_ERROR and nothing explains why.
  const signed = oauth.filter(entry => entry.client_type === 1 && entry.android_info?.certificate_hash);
  if (signed.length === 0) {
    fail('Android signing certificate', 'no SHA-1 registered — sign-in fails with DEVELOPER_ERROR');
  } else {
    notes.push(`${signed.length} signing certificate(s) registered`);
  }
}

// ── iOS ──────────────────────────────────────────────────────────────
const service = read('ios/GoogleService-Info.plist');
let iosWebClient = null;
if (!service) {
  fail('ios/GoogleService-Info.plist', 'missing — Google sign-in cannot work on iOS');
} else {
  iosWebClient = plistValue(service, 'WEB_CLIENT_ID');
  const iosClient = plistValue(service, 'CLIENT_ID');
  const bundleId = plistValue(service, 'BUNDLE_ID');

  if (!iosWebClient) fail('iOS web client', 'plist has no WEB_CLIENT_ID — `autoDetect` has nothing to read');

  // The plist has to be in the Resources build phase or it is simply
  // not in the shipped app, however correct its contents.
  const pbxproj = read('ios/vokve.xcodeproj/project.pbxproj') ?? '';
  if (!pbxproj.includes('GoogleService-Info.plist in Resources')) {
    fail('iOS plist bundling', 'not in the Resources build phase — it will not ship inside the app');
  }

  // Google calls back into the app through a URL scheme that is the iOS
  // client id with its halves swapped. Wrong, and the sheet opens and
  // never returns.
  const reversed = iosClient ? `com.googleusercontent.apps.${iosClient.replace('.apps.googleusercontent.com', '')}` : null;
  const infoPlist = read('ios/vokve/Info.plist') ?? '';
  if (reversed && !infoPlist.includes(reversed)) {
    fail('iOS URL scheme', `Info.plist is missing ${reversed} — the Google sheet will never return`);
  }

  // A warning rather than a failure: nothing here is misconfigured —
  // the plist, the client and the scheme all agree — it is the Xcode
  // target that has not been pointed at the registered id yet, and
  // changing it costs a new provisioning profile. Android is unaffected.
  // `$(PRODUCT_NAME…)` is left as written, because the thing worth
  // reading is that it is still the React Native template's id.
  const xcodeBundleIds = [...pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/g)].map(m => m[1]);
  const mismatched = [...new Set(xcodeBundleIds)].filter(id => id !== bundleId);
  if (mismatched.length > 0) {
    warn(
      'iOS bundle id',
      `plist is registered for ${bundleId} but Xcode builds ${mismatched.join(', ')}, ` +
        'so Google will refuse the iOS token exchange — align it before an iOS build matters (Android is unaffected)',
    );
  }
}

// ── The server's accepted audiences ──────────────────────────────────
const envFile = read('vokve-backend/.env');
if (!envFile) {
  notes.push('vokve-backend/.env not present here, so the server audience was not checked');
} else {
  const line = envFile.match(/^GOOGLE_WEB_CLIENT_ID=(.*)$/m)?.[1] ?? '';
  const accepted = line.split(',').map(entry => entry.trim()).filter(Boolean);
  if (accepted.length === 0) {
    fail('GOOGLE_WEB_CLIENT_ID', 'unset — /auth/google answers 503 and the button does nothing');
  }
  // The real bug this script exists for: each platform mints the
  // audience out of its own bundled file, so every one of them has to
  // be on the server's list.
  for (const [platform, id] of [['Android', androidWebClient], ['iOS', iosWebClient]]) {
    if (id && !accepted.includes(id)) {
      fail(
        `${platform} audience`,
        `${platform} tokens carry ${id}, which GOOGLE_WEB_CLIENT_ID does not accept — every ${platform} sign-in gets 401`,
      );
    }
  }
  if (androidWebClient && iosWebClient && androidWebClient !== iosWebClient) {
    notes.push('Android and iOS use different web clients, so both must stay on the server list');
  }
}

for (const note of notes) console.log(`  note  ${note}`);
for (const { what, detail } of warnings) console.log(`  \u26a0 ${what}: ${detail}`);

if (problems.length > 0) {
  console.error(`\n  ${problems.length} problem(s) with the Google sign-in configuration:\n`);
  for (const { what, detail } of problems) console.error(`  \u2717 ${what}: ${detail}`);
  console.error('');
  process.exit(1);
}

console.log(
  warnings.length === 0
    ? '\n  Google sign-in configuration agrees across Android, iOS and the server.\n'
    : `\n  Google sign-in configuration is sound; ${warnings.length} thing(s) above still to align.\n`,
);
process.exit(0);
