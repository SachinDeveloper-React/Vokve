/**
 * The phone's half of Facebook Login (RULES O18): Android's access token or
 * iPhone's Limited Login token, and no Facebook session left behind.
 *
 * @format
 */

import { Platform } from 'react-native';
import { AccessToken, AuthenticationToken, LoginManager } from 'react-native-fbsdk-next';
import { isFacebookSignInAvailable, signInWithFacebook } from '../src/services/facebookSignIn';

const logIn = LoginManager.logInWithPermissions as jest.Mock;
const logOut = LoginManager.logOut as jest.Mock;
const currentToken = AccessToken.getCurrentAccessToken as jest.Mock;
const limitedToken = AuthenticationToken.getAuthenticationTokenIOS as jest.Mock;

const original = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  logIn.mockResolvedValue({ isCancelled: false, grantedPermissions: ['public_profile', 'email'] });
  currentToken.mockResolvedValue({ accessToken: 'facebook-access-token' });
  limitedToken.mockResolvedValue({ authenticationToken: 'facebook-limited-token', nonce: 'facebook-nonce-0123', graphDomain: 'facebook' });
});

afterAll(() => {
  Platform.OS = original;
});

test('Android: asks for the profile and email, hands back the access token, and keeps no session', async () => {
  await expect(signInWithFacebook()).resolves.toEqual({ kind: 'signed_in', proof: { accessToken: 'facebook-access-token' } });

  expect(logIn).toHaveBeenCalledWith(['public_profile', 'email'], 'limited');
  expect(limitedToken).not.toHaveBeenCalled();
  // Before, so an earlier login cannot stand in for this one; after, so
  // the next press on a shared phone goes through Facebook again.
  expect(logOut).toHaveBeenCalledTimes(2);
  expect(logOut.mock.invocationCallOrder[0]).toBeLessThan(logIn.mock.invocationCallOrder[0]);
});

test('a cancel is a cancel, not a failure', async () => {
  logIn.mockResolvedValueOnce({ isCancelled: true });
  await expect(signInWithFacebook()).resolves.toEqual({ kind: 'cancelled' });
  expect(currentToken).not.toHaveBeenCalled();
});

test('an unregistered key hash is named as a setup fault, not "try again"', async () => {
  logIn.mockRejectedValueOnce(new Error('Invalid key hash. The key hash abc= does not match any stored key hashes.'));
  await expect(signInWithFacebook()).resolves.toEqual({
    kind: 'failed',
    message: 'Facebook sign-in is not set up for this build of the app.',
  });
});

test('no token after a login is a failure', async () => {
  currentToken.mockResolvedValueOnce(null);
  await expect(signInWithFacebook()).resolves.toMatchObject({ kind: 'failed' });
});

test('iPhone: Limited Login, so no tracking prompt — the signed token and its nonce go to the server', async () => {
  Platform.OS = 'ios';
  expect(isFacebookSignInAvailable()).toBe(true);

  await expect(signInWithFacebook()).resolves.toEqual({
    kind: 'signed_in',
    proof: { authenticationToken: 'facebook-limited-token', nonce: 'facebook-nonce-0123' },
  });
  expect(logIn).toHaveBeenCalledWith(['public_profile', 'email'], 'limited');
  expect(currentToken).not.toHaveBeenCalled();
  // Read before the SDK forgets it.
  expect(limitedToken.mock.invocationCallOrder[0]).toBeLessThan(logOut.mock.invocationCallOrder[1]);
});

test('iPhone: a token without its nonce is not sent', async () => {
  Platform.OS = 'ios';
  limitedToken.mockResolvedValueOnce({ authenticationToken: 'facebook-limited-token', nonce: '' });
  await expect(signInWithFacebook()).resolves.toMatchObject({ kind: 'failed' });
});

test('anything that is neither phone cannot reach the SDK', async () => {
  Platform.OS = 'web' as typeof Platform.OS;
  expect(isFacebookSignInAvailable()).toBe(false);
  await expect(signInWithFacebook()).resolves.toMatchObject({ kind: 'failed' });
  expect(logIn).not.toHaveBeenCalled();
});
