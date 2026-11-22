import type { AppleConfirmation } from './api/contracts';
import { signInWithApple } from './appleSignIn';
import { signInWithGoogle } from './googleSignIn';

export type ProviderProof =
  | { apple: AppleConfirmation }
  | { google: { idToken: string } };

/**
 * A fresh Apple or Google sign-in, as the proof an account without a
 * password gives before something that matters (RULES O16, O17) —
 * deleting it, changing its email, letting go of Apple.
 *
 * `null` when the member backed out of the provider's sheet: a decision,
 * not an error, so the caller says nothing. A provider that failed throws,
 * in words the caller can put in front of the member.
 */
export async function confirmWithProvider(provider: 'apple' | 'google'): Promise<ProviderProof | null> {
  if (provider === 'apple') {
    const outcome = await signInWithApple();
    if (outcome.kind === 'cancelled') return null;
    if (outcome.kind === 'failed') throw new Error(outcome.message);
    if (!outcome.authorizationCode) {
      throw new Error('Apple did not confirm. Please try again.');
    }
    return {
      apple: {
        idToken: outcome.idToken,
        nonce: outcome.nonce,
        authorizationCode: outcome.authorizationCode,
      },
    };
  }
  const outcome = await signInWithGoogle();
  if (outcome.kind === 'cancelled') return null;
  if (outcome.kind === 'failed') throw new Error(outcome.message);
  return { google: { idToken: outcome.idToken } };
}
