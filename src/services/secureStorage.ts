import * as Keychain from 'react-native-keychain';
import { z } from 'zod';
import {
  authTokensSchema,
  userSchema,
  type AuthTokens,
  type User,
} from '../types/models';
import { logger } from '../utils/logger';

const TOKEN_SERVICE = 'vokve.auth.tokens';
const USER_SERVICE = 'vokve.auth.user';

/**
 * How old a snapshot may be and still open the app on itself.
 *
 * It is replaced every time the server confirms the session, so a member who
 * opens the app at all keeps it fresh; a month is the point at which showing
 * somebody their own figures stops being a kindness and starts being a guess
 * about an account that may no longer exist.
 */
const USER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** The snapshot, with when the server last confirmed it. */
const storedUserSchema = z.object({ at: z.number(), user: userSchema });

/**
 * The tokens as this process last read or wrote them: `undefined` until the
 * Keychain has answered once, then the tokens or `null` for "signed out".
 *
 * Every request asks for the access token, and the Keychain is not a
 * variable — on Android each read is a round trip to the Keystore to
 * decrypt the entry, tens of milliseconds, and a launch fires a dozen
 * requests at once. So the Keychain is read once and this is what the
 * requests get. It is in memory only, in the one JavaScript runtime the
 * app, its headless tasks and its push handler share, and every write goes
 * through `saveTokens` / `clearTokens` below, which keep it in step — so it
 * cannot disagree with the Keychain, and it is gone when the process is.
 */
let cachedTokens: AuthTokens | null | undefined;
/** The first read, shared by everything that asked before it answered. */
let pendingRead: Promise<AuthTokens | null> | null = null;

async function readTokensFromKeychain(): Promise<AuthTokens | null> {
  try {
    const entry = await Keychain.getGenericPassword({
      service: TOKEN_SERVICE,
    });
    // A sign-in or sign-out that finished while the Keychain was being read
    // is newer than what it returned, and wins.
    if (cachedTokens !== undefined) {
      return cachedTokens;
    }
    if (!entry) {
      cachedTokens = null;
      return null;
    }

    const parsed = authTokensSchema.safeParse(JSON.parse(entry.password));
    if (!parsed.success) {
      // A shape change means the stored blob is unusable — drop it so the
      // user gets a clean sign-in instead of a confusing failure later.
      await secureStorage.clearTokens();
      return null;
    }
    cachedTokens = parsed.data;
    return parsed.data;
  } catch (error) {
    // Not remembered: a Keychain that failed once is asked again next time,
    // rather than one bad read signing the member out until the app restarts.
    logger.error('secureStorage', 'Failed to read auth tokens', error);
    return null;
  }
}

/**
 * Auth tokens live in the Keychain / Android Keystore, never in MMKV.
 * MMKV is plain-text on disk, which is fine for a theme preference and wrong
 * for a credential that grants access to a user's health data.
 */
export const secureStorage = {
  async saveTokens(tokens: AuthTokens): Promise<void> {
    cachedTokens = tokens;
    try {
      await Keychain.setGenericPassword('tokens', JSON.stringify(tokens), {
        service: TOKEN_SERVICE,
      });
    } catch (error) {
      logger.error('secureStorage', 'Failed to persist auth tokens', error);
    }
  },

  async readTokens(): Promise<AuthTokens | null> {
    if (cachedTokens !== undefined) {
      return cachedTokens;
    }
    pendingRead =
      pendingRead ??
      readTokensFromKeychain().finally(() => {
        pendingRead = null;
      });
    return pendingRead;
  },

  async clearTokens(): Promise<void> {
    cachedTokens = null;
    try {
      await Keychain.resetGenericPassword({ service: TOKEN_SERVICE });
    } catch (error) {
      logger.error('secureStorage', 'Failed to clear auth tokens', error);
    }
  },

  /**
   * Remembers the signed-in member, so a launch that cannot reach the server
   * can still draw the app around them.
   *
   * Beside the tokens rather than in MMKV, for the same reason the tokens are
   * there: a name, a phone number, a height and a weight are the member's
   * health data, and a cache of them has no business being plain text on
   * disk. It goes when the session goes (`clearUser`).
   */
  async saveUser(user: User): Promise<void> {
    try {
      await Keychain.setGenericPassword(
        'user',
        JSON.stringify({ at: Date.now(), user }),
        { service: USER_SERVICE },
      );
    } catch (error) {
      logger.error('secureStorage', 'Failed to persist the session user', error);
    }
  },

  /**
   * The remembered member, or null when there is none worth using — nothing
   * stored, a shape from an older build, or a snapshot older than
   * `USER_MAX_AGE_MS`. An unusable snapshot is dropped rather than left to be
   * re-read on every launch.
   */
  async readUser(): Promise<User | null> {
    try {
      const entry = await Keychain.getGenericPassword({
        service: USER_SERVICE,
      });
      if (!entry) {
        return null;
      }

      const parsed = storedUserSchema.safeParse(JSON.parse(entry.password));
      if (!parsed.success) {
        await secureStorage.clearUser();
        return null;
      }
      if (Date.now() - parsed.data.at > USER_MAX_AGE_MS) {
        await secureStorage.clearUser();
        return null;
      }
      return parsed.data.user;
    } catch (error) {
      logger.error('secureStorage', 'Failed to read the session user', error);
      return null;
    }
  },

  async clearUser(): Promise<void> {
    try {
      await Keychain.resetGenericPassword({ service: USER_SERVICE });
    } catch (error) {
      logger.error('secureStorage', 'Failed to clear the session user', error);
    }
  },
};
