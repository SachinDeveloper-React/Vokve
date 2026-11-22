#!/usr/bin/env node
/**
 * Does Apple sign-in agree with itself? (RULES O13)
 *
 * The Google lesson (D-95), applied before it costs a day: sign-in is
 * configured in several places nothing forces to match, and when two of
 * them disagree the failure is a 401 from the server or an error page
 * inside Apple's sheet — never a stack trace. So the agreement is
 * checked:
 *
 *   iOS      entitlements file has Sign in with Apple ──► Xcode points at it
 *   iOS      device bundle id                         ──┐
 *   Android  config.appleServiceId (Services ID)      ──┴─► server APPLE_CLIENT_IDS
 *   Android  config.appleRedirectUri                  ────► an https URL
 *
 * A `✗` cannot work and fails the command; a `⚠` works on the builds it
 * has not broken. What it cannot see is Apple's side — the capability on
 * the App ID and the Services ID's return URL live in the developer
 * account — and it says so at the end rather than implying it checked.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const warnings = [];
const notes = [];
const fail = (what, detail) => problems.push({ what, detail });
const warn = (what, detail) => warnings.push({ what, detail });
const read = path => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);

// ── The server's accepted audiences ──────────────────────────────────
const envFile = read('vokve-backend/.env');
let accepted = null;
if (!envFile) {
  notes.push('vokve-backend/.env not present here, so the server audience was not checked');
} else {
  accepted = (envFile.match(/^APPLE_CLIENT_IDS=(.*)$/m)?.[1] ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
  if (accepted.length === 0) {
    fail('APPLE_CLIENT_IDS', 'unset — /auth/apple answers 503 on both platforms');
  }
}
const mustAccept = (platform, id) => {
  if (accepted && id && !accepted.includes(id)) {
    fail(
      `${platform} audience`,
      `${platform} tokens are addressed to ${id}, which APPLE_CLIENT_IDS does not list — every ${platform} Apple sign-in gets 401`,
    );
  }
};

// ── iOS ──────────────────────────────────────────────────────────────
const pbxproj = read('ios/vokve.xcodeproj/project.pbxproj') ?? '';
const entitlementsPaths = [...pbxproj.matchAll(/CODE_SIGN_ENTITLEMENTS = "?([^";]+)"?;/g)].map(m => m[1]);
if (entitlementsPaths.length === 0) {
  fail('iOS entitlements', 'no CODE_SIGN_ENTITLEMENTS in the Xcode target — performRequest fails with error 1000');
} else {
  for (const path of new Set(entitlementsPaths)) {
    const text = read(join('ios', path));
    if (!text) fail('iOS entitlements', `ios/${path} is named by Xcode but does not exist`);
    else if (!text.includes('com.apple.developer.applesignin')) {
      fail('iOS entitlements', `ios/${path} has no com.apple.developer.applesignin — performRequest fails with error 1000`);
    }
  }
}

// The key is quoted when it carries an SDK condition:
//   "PRODUCT_BUNDLE_IDENTIFIER[sdk=iphoneos*]" = com.vokve.fitness;
const bundleIds = [...pbxproj.matchAll(/"?PRODUCT_BUNDLE_IDENTIFIER(?:\[sdk=([^\]]+)\])?"? = "?([^";]+)"?;/g)].map(
  m => ({ sdk: m[1] ?? null, id: m[2] }),
);
const deviceIds = new Set(bundleIds.filter(b => b.sdk?.startsWith('iphoneos')).map(b => b.id));
const defaultIds = new Set(bundleIds.filter(b => !b.sdk).map(b => b.id));
// With no device-specific id, the default is what a device builds.
for (const id of deviceIds.size > 0 ? deviceIds : defaultIds) mustAccept('iOS', id);
if (deviceIds.size > 0) {
  for (const id of defaultIds) {
    if (!deviceIds.has(id)) {
      warn(
        'iOS simulator bundle id',
        `simulator builds use ${id}, which has no Sign in with Apple capability — test Apple sign-in on a device, or point the simulator at the device id`,
      );
    }
  }
}

// ── Android ──────────────────────────────────────────────────────────
const appConfig = read('src/constants/config.ts') ?? '';
const serviceId = appConfig.match(/appleServiceId:\s*'([^']*)'/)?.[1] ?? null;
const redirectUri = appConfig.match(/appleRedirectUri:\s*'([^']*)'/)?.[1] ?? null;
if (!serviceId) fail('Android Services ID', 'config.appleServiceId is unset — the Apple tile says it is not set up');
if (!redirectUri) fail('Android return URL', 'config.appleRedirectUri is unset — the Apple tile says it is not set up');
else if (!redirectUri.startsWith('https://')) {
  fail('Android return URL', `${redirectUri} is not https — Apple refuses any other return URL`);
}
mustAccept('Android', serviceId);

// ── Revocation (RULES O16) ───────────────────────────────────────────
// Deleting an account or disconnecting Apple revokes the member's Apple
// authorisation, which App Review requires. A ⚠ rather than a ✗: sign-in
// works without it, and the server says so on every boot.
if (envFile) {
  const envValue = name => (envFile.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1] ?? '').trim();
  const missing = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'].filter(name => !envValue(name));
  if (missing.length > 0) {
    warn('Apple revocation', `${missing.join(', ')} unset — account deletion cannot revoke Apple tokens (App Store Review Guideline 5.1.1(v))`);
  } else if (!envValue('APPLE_PRIVATE_KEY').includes('BEGIN PRIVATE KEY')) {
    fail('Apple revocation', 'APPLE_PRIVATE_KEY does not look like a .p8 (no BEGIN PRIVATE KEY line)');
  }
  const serverRedirect = envValue('APPLE_REDIRECT_URI');
  if (redirectUri && serverRedirect !== redirectUri) {
    warn(
      'Apple revocation',
      `APPLE_REDIRECT_URI is ${serverRedirect || 'unset'} but the app returns to ${redirectUri} — Android codes will not exchange, so an Android deletion cannot revoke`,
    );
  }
}

for (const note of notes) console.log(`  note  ${note}`);
console.log(
  `  note  not checkable from here: Sign in with Apple enabled on the App ID; Services ID ${serviceId ?? '(unset)'} ` +
    `grouped with it, with ${redirectUri ? new URL(redirectUri).host : '(unset)'} as a domain and ${redirectUri ?? '(unset)'} as a return URL`,
);
for (const { what, detail } of warnings) console.log(`  ⚠ ${what}: ${detail}`);

if (problems.length > 0) {
  console.error(`\n  ${problems.length} problem(s) with the Apple sign-in configuration:\n`);
  for (const { what, detail } of problems) console.error(`  ✗ ${what}: ${detail}`);
  console.error('');
  process.exit(1);
}

console.log(
  warnings.length === 0
    ? '\n  Apple sign-in configuration agrees across iOS, Android and the server.\n'
    : `\n  Apple sign-in configuration is sound; ${warnings.length} thing(s) above still to align.\n`,
);
process.exit(0);
