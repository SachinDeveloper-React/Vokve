import { newTotpSecret, totpAt, totpCounter, totpUri } from '../lib/totp.js';

/**
 * Makes the operator's authenticator secret (RULES Z7).
 *
 *   npm run admin:totp            a new secret
 *   npm run admin:totp -- <secret> the code an existing one shows now
 *
 * Add the secret to an authenticator app (Google Authenticator, 1Password,
 * Authy: "enter a setup key", time-based), check the six digits it shows
 * match the ones printed here, then set `ADMIN_TOTP_SECRET` on the API and
 * redeploy. From then on the panel asks for the code at sign-in, and the
 * bare admin key opens nothing on its own.
 *
 * Nothing is sent anywhere — no QR service, no network. The secret is as
 * sensitive as the admin key: keep it in the password manager, not a chat.
 */
const given = process.argv[2]?.trim();
const secret = given || newTotpSecret();

console.log(given ? '\nExisting secret' : '\nNew admin authenticator secret (RULES Z7)');
console.log('──────────────────────────────────────────────');
console.log(`Setup key:   ${secret.replace(/(.{4})/g, '$1 ').trim()}`);
console.log(`otpauth URI: ${totpUri(secret, 'operator')}`);
console.log(`Code now:    ${totpAt(secret, totpCounter())}  (should match the app)`);
if (!given) {
  console.log('\nThen, on the API (Vercel → Settings → Environment Variables, and .env):');
  console.log(`  ADMIN_TOTP_SECRET=${secret}`);
}
console.log('');
