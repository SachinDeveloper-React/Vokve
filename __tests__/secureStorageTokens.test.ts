/**
 * The tokens are read from the Keychain once and remembered.
 *
 * Every request asks for the access token, and on Android each Keychain
 * read is a round trip to the Keystore. What matters about the memory is
 * that it can never disagree with what is stored: a sign-in replaces it, a
 * sign-out empties it, and a Keychain that failed is asked again rather
 * than believed.
 *
 * @format
 */

import * as Keychain from 'react-native-keychain';

const getGenericPassword = Keychain.getGenericPassword as jest.Mock;
const setGenericPassword = Keychain.setGenericPassword as jest.Mock;
const resetGenericPassword = Keychain.resetGenericPassword as jest.Mock;

const TOKENS = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1_900_000_000_000,
};
const NEWER = { ...TOKENS, accessToken: 'access-2', refreshToken: 'refresh-2' };

const stored = (tokens: object) => ({
  username: 'tokens',
  password: JSON.stringify(tokens),
  service: 'vokve.auth.tokens',
  storage: 'keystore',
});

/** A fresh module each time: the memory under test is module state. */
function load() {
  let storage!: typeof import('../src/services/secureStorage').secureStorage;
  jest.isolateModules(() => {
    storage = require('../src/services/secureStorage').secureStorage;
  });
  return storage;
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  getGenericPassword.mockReset().mockResolvedValue(false);
  setGenericPassword.mockReset().mockResolvedValue(true);
  resetGenericPassword.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('reads the Keychain once, however many requests ask', async () => {
  getGenericPassword.mockResolvedValue(stored(TOKENS));
  const storage = load();

  // A launch: several requests before the first read has answered…
  const together = await Promise.all([
    storage.readTokens(),
    storage.readTokens(),
    storage.readTokens(),
  ]);
  // …and the rest of the session after it.
  const later = await storage.readTokens();

  expect(together).toEqual([TOKENS, TOKENS, TOKENS]);
  expect(later).toEqual(TOKENS);
  expect(getGenericPassword).toHaveBeenCalledTimes(1);
});

it('remembers that nobody is signed in', async () => {
  const storage = load();

  expect(await storage.readTokens()).toBeNull();
  expect(await storage.readTokens()).toBeNull();
  expect(getGenericPassword).toHaveBeenCalledTimes(1);
});

it('hands back what a sign-in saved, not what was read before it', async () => {
  getGenericPassword.mockResolvedValue(stored(TOKENS));
  const storage = load();
  await storage.readTokens();

  await storage.saveTokens(NEWER);

  expect(await storage.readTokens()).toEqual(NEWER);
  expect(setGenericPassword).toHaveBeenCalledWith(
    'tokens',
    JSON.stringify(NEWER),
    { service: 'vokve.auth.tokens' },
  );
});

it('forgets the tokens on sign-out', async () => {
  getGenericPassword.mockResolvedValue(stored(TOKENS));
  const storage = load();
  await storage.readTokens();

  await storage.clearTokens();

  expect(await storage.readTokens()).toBeNull();
  expect(resetGenericPassword).toHaveBeenCalledWith({
    service: 'vokve.auth.tokens',
  });
});

it('lets a sign-in that lands during the first read win', async () => {
  let answer!: (entry: unknown) => void;
  getGenericPassword.mockReturnValue(
    new Promise(resolve => {
      answer = resolve;
    }),
  );
  const storage = load();

  const reading = storage.readTokens();
  await storage.saveTokens(NEWER);
  answer(stored(TOKENS));

  expect(await reading).toEqual(NEWER);
  expect(await storage.readTokens()).toEqual(NEWER);
});

it('asks again after a Keychain failure instead of remembering it', async () => {
  getGenericPassword.mockRejectedValueOnce(new Error('keystore busy'));
  const storage = load();

  expect(await storage.readTokens()).toBeNull();

  getGenericPassword.mockResolvedValue(stored(TOKENS));
  expect(await storage.readTokens()).toEqual(TOKENS);
});

it('drops a stored blob of the wrong shape and reports signed out', async () => {
  getGenericPassword.mockResolvedValue(stored({ accessToken: 42 }));
  const storage = load();

  expect(await storage.readTokens()).toBeNull();
  expect(resetGenericPassword).toHaveBeenCalledWith({
    service: 'vokve.auth.tokens',
  });
  expect(await storage.readTokens()).toBeNull();
  expect(getGenericPassword).toHaveBeenCalledTimes(1);
});
