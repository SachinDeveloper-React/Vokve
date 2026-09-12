import * as Keychain from 'react-native-keychain';
import { authTokensSchema, type AuthTokens } from '../types/models';
import { logger } from '../utils/logger';

const TOKEN_SERVICE = 'vokve.auth.tokens';

/**
 * Auth tokens live in the Keychain / Android Keystore, never in MMKV.
 * MMKV is plain-text on disk, which is fine for a theme preference and wrong
 * for a credential that grants access to a user's health data.
 */
export const secureStorage = {
  async saveTokens(tokens: AuthTokens): Promise<void> {
    try {
      await Keychain.setGenericPassword('tokens', JSON.stringify(tokens), {
        service: TOKEN_SERVICE,
      });
    } catch (error) {
      logger.error('secureStorage', 'Failed to persist auth tokens', error);
    }
  },

  async readTokens(): Promise<AuthTokens | null> {
    try {
      const entry = await Keychain.getGenericPassword({
        service: TOKEN_SERVICE,
      });
      if (!entry) {
        return null;
      }

      const parsed = authTokensSchema.safeParse(JSON.parse(entry.password));
      if (!parsed.success) {
        // A shape change means the stored blob is unusable — drop it so the
        // user gets a clean sign-in instead of a confusing failure later.
        await secureStorage.clearTokens();
        return null;
      }
      return parsed.data;
    } catch (error) {
      logger.error('secureStorage', 'Failed to read auth tokens', error);
      return null;
    }
  },

  async clearTokens(): Promise<void> {
    try {
      await Keychain.resetGenericPassword({ service: TOKEN_SERVICE });
    } catch (error) {
      logger.error('secureStorage', 'Failed to clear auth tokens', error);
    }
  },
};
