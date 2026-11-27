import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import {
  APPLE_ISSUER,
  forgetAppleKeys,
  isAppleSignInConfigured,
  verifyAppleIdToken,
  verifyAppleNotification,
} from '../src/lib/appleIdentity.js';

/**
 * The real Apple verifier (RULES O13), against keys made here.
 *
 * `appleAuth.test.ts` replaces the verifier, so nothing there would notice
 * if the signature, the audience, the issuer, the expiry or the nonce
 * stopped being checked — each of which fails silently in the dangerous
 * direction. So this file signs real RS256 tokens with a key of its own,
 * serves that key where Apple's would be, and checks each refusal.
 */

const IOS = 'com.vokve.fitness';
const SERVICE = 'com.vokve.fitness.signin';
const NONCE = 'raw-nonce-0123456789abcdef';
const hashed = (nonce: string) => createHash('sha256').update(nonce).digest('hex');

const makeKey = (kid: string) => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...(publicKey.export({ format: 'jwk' }) as object), kid, alg: 'RS256', use: 'sig' } };
};

const apple = makeKey('apple-key-1');
const stranger = makeKey('apple-key-1'); // same kid, different key: a forgery

let served: object[] = [apple.jwk];
const fetchKeys = vi.fn(async () => new Response(JSON.stringify({ keys: served }), { status: 200 }));

const token = (
  claims: Record<string, unknown> = {},
  { key = apple.privateKey, kid = apple.kid, aud = IOS }: { key?: KeyObject; kid?: string; aud?: string } = {},
) =>
  jwt.sign(
    {
      sub: '001234.apple-sub.0001',
      email: 'Rana@Example.com',
      email_verified: 'true',
      is_private_email: 'false',
      nonce: hashed(NONCE),
      ...claims,
    },
    key,
    {
      algorithm: 'RS256',
      keyid: kid,
      issuer: APPLE_ISSUER,
      audience: aud,
      // A test that sets `exp` itself means it; the library refuses both.
      ...('exp' in claims ? {} : { expiresIn: 600 }),
    },
  );

beforeEach(() => {
  env.APPLE_CLIENT_IDS = `${IOS}, ${SERVICE}`;
  served = [apple.jwk];
  fetchKeys.mockClear();
  forgetAppleKeys();
  vi.stubGlobal('fetch', fetchKeys);
});

afterEach(() => {
  vi.unstubAllGlobals();
  env.APPLE_CLIENT_IDS = undefined;
});

describe('a token Apple signed for us', () => {
  it('is accepted from iOS (the bundle id) and from Android (the Services ID)', async () => {
    for (const aud of [IOS, SERVICE]) {
      await expect(verifyAppleIdToken(token({}, { aud }), NONCE)).resolves.toEqual({
        appleId: '001234.apple-sub.0001',
        email: 'rana@example.com',
        isPrivateEmail: false,
        // Which client it was for: what revoking it later has to name (RULES O16).
        audience: aud,
      });
    }
    // And the keys were fetched once, not once a sign-in.
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  it('reads the boolean claims whether Apple wrote them as booleans or strings', async () => {
    const identity = await verifyAppleIdToken(
      token({ email_verified: true, is_private_email: true, email: 'x@privaterelay.appleid.com' }),
      NONCE,
    );
    expect(identity).toMatchObject({ email: 'x@privaterelay.appleid.com', isPrivateEmail: true });
  });

  it('reports no email where Apple has not verified one', async () => {
    const identity = await verifyAppleIdToken(token({ email_verified: 'false' }), NONCE);
    expect(identity.email).toBeNull();
  });

  it('reports no email where the token has none', async () => {
    const identity = await verifyAppleIdToken(token({ email: undefined }), NONCE);
    expect(identity.email).toBeNull();
  });
});

describe('what it refuses', () => {
  const refused = { status: 401, code: 'APPLE_TOKEN_INVALID' };

  it('the same token a second time — the nonce is the phone\'s own, so it cannot stop a replay (audit 2026-11-27, I-1)', async () => {
    const once = token({ jti: 'replayed' });
    await expect(verifyAppleIdToken(once, NONCE)).resolves.toMatchObject({ appleId: '001234.apple-sub.0001' });
    await expect(verifyAppleIdToken(once, NONCE)).rejects.toMatchObject(refused);
  });

  it('a token addressed to somebody else’s app', async () => {
    await expect(verifyAppleIdToken(token({}, { aud: 'com.someone.else' }), NONCE)).rejects.toMatchObject(refused);
  });

  it('a token from another issuer', async () => {
    const forged = jwt.sign({ sub: 'x', nonce: hashed(NONCE) }, apple.privateKey, {
      algorithm: 'RS256', keyid: apple.kid, issuer: 'https://accounts.google.com', audience: IOS, expiresIn: 600,
    });
    await expect(verifyAppleIdToken(forged, NONCE)).rejects.toMatchObject(refused);
  });

  it('a token signed with a key that is not Apple’s, under Apple’s key id', async () => {
    await expect(
      verifyAppleIdToken(token({}, { key: stranger.privateKey }), NONCE),
    ).rejects.toMatchObject(refused);
  });

  it('an expired token', async () => {
    const old = token({ iat: Math.floor(Date.now() / 1000) - 3600, exp: Math.floor(Date.now() / 1000) - 600 });
    await expect(verifyAppleIdToken(old, NONCE)).rejects.toMatchObject(refused);
  });

  it('a token minted for a different nonce', async () => {
    await expect(verifyAppleIdToken(token(), 'some-other-raw-nonce-000')).rejects.toMatchObject(refused);
  });

  it('a token with no nonce in it at all', async () => {
    await expect(verifyAppleIdToken(token({ nonce: undefined }), NONCE)).rejects.toMatchObject(refused);
  });

  it('the hash itself sent as the nonce', async () => {
    // Somebody who only has the token has only the hash; that must not do.
    await expect(verifyAppleIdToken(token(), hashed(NONCE))).rejects.toMatchObject(refused);
  });

  it('a token that is not a JWT', async () => {
    await expect(verifyAppleIdToken('not-a-token', NONCE)).rejects.toMatchObject(refused);
  });

  it('an unsigned token', async () => {
    const unsigned = jwt.sign({ sub: 'x', nonce: hashed(NONCE) }, '', {
      algorithm: 'none', issuer: APPLE_ISSUER, audience: IOS, keyid: apple.kid,
    });
    await expect(verifyAppleIdToken(unsigned, NONCE)).rejects.toMatchObject(refused);
  });
});

describe('Apple’s keys', () => {
  it('picks up a rotated key by fetching again, but not on every unknown id', async () => {
    await verifyAppleIdToken(token(), NONCE);
    expect(fetchKeys).toHaveBeenCalledTimes(1);

    // A key id we have never seen, a moment after fetching: not worth
    // asking Apple again yet, or made-up ids would hammer it.
    const rotated = makeKey('apple-key-2');
    served = [apple.jwk, rotated.jwk];
    await expect(
      verifyAppleIdToken(token({}, { key: rotated.privateKey, kid: rotated.kid }), NONCE),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchKeys).toHaveBeenCalledTimes(1);

    // A minute on, the same token makes it fetch, and the new key works.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61_000);
    try {
      const fresh = token({}, { key: rotated.privateKey, kid: rotated.kid });
      await expect(verifyAppleIdToken(fresh, NONCE)).resolves.toMatchObject({ appleId: '001234.apple-sub.0001' });
      expect(fetchKeys).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers 503, not 401, when Apple cannot be reached and no keys are held', async () => {
    fetchKeys.mockRejectedValueOnce(new Error('network down'));
    await expect(verifyAppleIdToken(token(), NONCE)).rejects.toMatchObject({
      status: 503,
      code: 'APPLE_SIGN_IN_UNAVAILABLE',
    });
  });
});

describe('when the server is not set up', () => {
  it('refuses to run at all rather than accepting any audience', async () => {
    env.APPLE_CLIENT_IDS = ' , ';
    expect(isAppleSignInConfigured()).toBe(false);
    await expect(verifyAppleIdToken(token(), NONCE)).rejects.toMatchObject({ status: 503 });
    expect(fetchKeys).not.toHaveBeenCalled();
  });
});

describe('a server-to-server notification (RULES O17)', () => {
  const notification = (
    events: unknown,
    { key = apple.privateKey, aud = IOS }: { key?: KeyObject; aud?: string } = {},
  ) =>
    jwt.sign({ events, jti: 'n-1' }, key, { algorithm: 'RS256', keyid: apple.kid, issuer: APPLE_ISSUER, audience: aud, expiresIn: 600 });

  it('reads one event, written as an object', async () => {
    const event = await verifyAppleNotification(
      notification({ type: 'email-disabled', sub: '001234.apple-sub.0001', email: 'X@privaterelay.appleid.com', is_private_email: 'true', event_time: 1795392000 }),
    );
    expect(event).toEqual({
      type: 'email-disabled',
      appleId: '001234.apple-sub.0001',
      email: 'x@privaterelay.appleid.com',
      at: new Date(1795392000 * 1000),
    });
  });

  it('reads one written as a JSON string, and both spellings of a deleted Apple ID', async () => {
    const event = await verifyAppleNotification(
      notification(JSON.stringify({ type: 'account-deleted', sub: '001234.apple-sub.0001', event_time: 1795392000 })),
    );
    expect(event).toMatchObject({ type: 'account-delete', appleId: '001234.apple-sub.0001', email: null });
  });

  it('answers null for a type it does not know, rather than refusing it', async () => {
    await expect(
      verifyAppleNotification(notification({ type: 'something-new', sub: '001234.apple-sub.0001' })),
    ).resolves.toBeNull();
  });

  it('refuses one signed by anyone but Apple, or addressed to another app', async () => {
    const consent = { type: 'consent-revoked', sub: '001234.apple-sub.0001' };
    await expect(verifyAppleNotification(notification(consent, { key: stranger.privateKey }))).rejects.toMatchObject({ status: 401 });
    await expect(verifyAppleNotification(notification(consent, { aud: 'com.someone.else' }))).rejects.toMatchObject({ status: 401 });
  });
});
