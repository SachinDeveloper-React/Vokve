import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which audiences a Google token may carry (RULES O12).
 *
 * This is the one part of the verifier the other Google tests cannot
 * reach: they replace the verifier wholesale, so nothing there would
 * notice if the audience stopped being enforced, or if a
 * comma-separated setting were handed to Google as one long nonsense
 * id. Both are silent failures — the first accepts tokens minted for
 * somebody else's app, the second refuses every sign-in on both
 * platforms — so they get a file of their own with the library mocked
 * at the seam instead.
 *
 * The real reason a list exists: Android reads its web client out of
 * `google-services.json` and iOS out of `GoogleService-Info.plist`, and
 * a Firebase project whose two apps were registered at different times
 * carries a different one in each. One accepted audience would mean one
 * platform failing every sign-in.
 */

const verifyIdToken = vi.fn();
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdToken;
  },
}));

const ANDROID = 'android-web.apps.googleusercontent.com';
const IOS = 'ios-web.apps.googleusercontent.com';

const payload = (over: Record<string, unknown> = {}) => ({
  sub: 'google-sub-1',
  iss: 'https://accounts.google.com',
  email: 'rana@example.com',
  email_verified: true,
  name: 'Rana Jay',
  ...over,
});

/**
 * No module reset here, deliberately: re-importing the config drags the
 * whole model layer in again and mongoose refuses to compile a schema
 * twice. It is also unnecessary — the verifier reads the setting on
 * every call rather than at import, and the only thing it caches is the
 * client object the mock above replaces.
 */
async function configure(setting: string | undefined) {
  const { env } = await import('../src/config/env.js');
  env.GOOGLE_WEB_CLIENT_ID = setting;
  return import('../src/lib/googleIdentity.js');
}

beforeEach(() => {
  verifyIdToken.mockReset();
  verifyIdToken.mockResolvedValue({ getPayload: () => payload() });
});

afterEach(async () => {
  const { env } = await import('../src/config/env.js');
  env.GOOGLE_WEB_CLIENT_ID = undefined;
});

describe('the accepted audience', () => {
  it('hands Google every configured client, not the raw setting', async () => {
    const { verifyGoogleIdToken } = await configure(`${ANDROID},${IOS}`);

    await verifyGoogleIdToken('tok');

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'tok',
      // A list. Passing the string would ask Google to match one
      // audience literally named "a,b" — which no token ever carries.
      audience: [ANDROID, IOS],
    });
  });

  it('accepts a token from either platform', async () => {
    const { verifyGoogleIdToken } = await configure(`${ANDROID},${IOS}`);

    for (const aud of [ANDROID, IOS]) {
      verifyIdToken.mockResolvedValueOnce({ getPayload: () => payload({ aud }) });
      await expect(verifyGoogleIdToken('tok')).resolves.toMatchObject({
        googleId: 'google-sub-1',
        email: 'rana@example.com',
      });
    }
  });

  it('tolerates the spaces somebody will put after the comma', async () => {
    const { verifyGoogleIdToken } = await configure(`  ${ANDROID} ,  ${IOS}  `);

    await verifyGoogleIdToken('tok');

    expect(verifyIdToken.mock.calls[0]![0].audience).toEqual([ANDROID, IOS]);
  });

  it('is still one id when only one is configured', async () => {
    const { verifyGoogleIdToken } = await configure(ANDROID);

    await verifyGoogleIdToken('tok');

    expect(verifyIdToken.mock.calls[0]![0].audience).toEqual([ANDROID]);
  });

  it('refuses to run at all when nothing is configured', async () => {
    const { verifyGoogleIdToken, isGoogleSignInConfigured } = await configure(undefined);

    expect(isGoogleSignInConfigured()).toBe(false);
    // 503, not 401: the server is misconfigured, and telling the app
    // "your token is bad" would send it round the sign-in loop forever.
    await expect(verifyGoogleIdToken('tok')).rejects.toMatchObject({ status: 503 });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('treats a setting of nothing but commas as not configured', async () => {
    const { isGoogleSignInConfigured } = await configure(' , , ');

    expect(isGoogleSignInConfigured()).toBe(false);
  });
});
