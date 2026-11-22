import { verifyAppleIdToken } from '../../lib/appleIdentity.js';
import { revokeAppleAuthorization, type RevocationResult } from '../../lib/appleTokens.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { verifyIdentityLinkToken, type IdentityLinkClaims } from '../../lib/tokens.js';
import { signInMethodsSchema, type SignInMethods, type SignInProvider } from '../../contracts/index.js';
import { notify } from '../notifications/service.js';
import { AuditLogModel } from '../platform/models.js';
import { confirmationFor } from './confirm.service.js';
import { UserModel, type UserDoc } from './models.js';
import { hasPassword } from './password.js';

/**
 * Connecting Google and Apple to an account that already exists (RULES O15).
 *
 * Sign-in can only link an identity to an account by its email, and a
 * member who hid their address from Apple shares none with the account
 * they made by email — so without this, pressing "Sign in with Apple"
 * on a new phone made them a second, empty account and their coins and
 * streak stayed in the first. Here the member is already signed in, so
 * the account is not in question: only the identity has to be proved,
 * by a token the provider just signed, or by the link token sign-in
 * handed out when it found no account for it.
 */

export type ProviderIdentity = IdentityLinkClaims;

const FIELD = { google: 'googleId', apple: 'appleId' } as const satisfies Record<SignInProvider, keyof UserDoc>;
export const PROVIDER_LABEL: Record<SignInProvider, string> = { google: 'Google account', apple: 'Apple ID' };
const PROVIDER_NAME: Record<SignInProvider, string> = { google: 'Google', apple: 'Apple' };
const PROVIDERS: SignInProvider[] = ['google', 'apple'];

export { hasPassword };

/** "rana@example.com" → "r•••@example.com", for naming an account to somebody who already owns it. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** Whether removing `provider` would leave the account with no way in. */
function waysIn(user: UserDoc): number {
  return (hasPassword(user) ? 1 : 0) + PROVIDERS.filter(p => Boolean(user[FIELD[p]])).length;
}

export function signInMethodsOf(user: UserDoc): SignInMethods {
  const ways = waysIn(user);
  return signInMethodsSchema.parse({
    password: hasPassword(user),
    // What a change to the account (its email) is confirmed with (O17):
    // the password, or the provider an account without one signs in with.
    confirmChangesWith: confirmationFor(user, 'change'),
    providers: PROVIDERS.map(provider => {
      const linked = Boolean(user[FIELD[provider]]);
      return { provider, linked, canDisconnect: linked && ways > 1 };
    }),
  });
}

async function liveUser(userId: string): Promise<UserDoc> {
  const user = await UserModel.findById(userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();
  return user;
}

export async function getSignInMethods(userId: string): Promise<SignInMethods> {
  return signInMethodsOf(await liveUser(userId));
}

export const identityLinkExpired = () =>
  new ApiError(410, 'IDENTITY_LINK_EXPIRED', 'That sign-in has expired. Connect it again from Account → Security.');

/** The identity a link token names, or the refusal. */
export function identityFromLinkToken(linkToken: string): ProviderIdentity {
  const identity = verifyIdentityLinkToken(linkToken);
  if (!identity) throw identityLinkExpired();
  return identity;
}

/**
 * Puts a proved identity on the signed-in member's account.
 *
 * One identity belongs to one account and one account holds at most one of
 * each provider: an identity already on another live account is refused
 * with that account's masked address — the member just proved they own the
 * identity, so the account is theirs too and naming it is how they find it —
 * and an account with a different Apple ID already on it has to let go of
 * that one first. A deleted account's hold is released: nobody can sign in
 * to an anonymised row, and keeping the id there would only stop its owner
 * connecting it anywhere else.
 */
export async function linkIdentity(userId: string, identity: ProviderIdentity, meta: { deviceId?: string }): Promise<SignInMethods> {
  const user = await liveUser(userId);
  const field = FIELD[identity.provider];
  const label = PROVIDER_LABEL[identity.provider];

  if (user[field] === identity.providerId) return signInMethodsOf(user);

  const holder = await UserModel.findOne({ [field]: identity.providerId });
  if (holder && holder._id !== user._id) {
    if (!holder.deletedAt) {
      throw new ApiError(
        409,
        'IDENTITY_IN_USE',
        `This ${label} already signs in to another VOKVE account (${maskEmail(holder.email)}). To move it here, sign in to that account and disconnect it under Security first.`,
        { provider: identity.provider, account: maskEmail(holder.email) },
      );
    }
    await UserModel.updateOne({ _id: holder._id }, { $unset: { [field]: 1 } });
  }

  if (user[field]) {
    throw new ApiError(
      409,
      'PROVIDER_ALREADY_LINKED',
      `This account is already connected to a different ${label}. Disconnect that one first.`,
      { provider: identity.provider },
    );
  }

  user.set(field, identity.providerId);
  if (!user.name && identity.name) user.name = identity.name;
  if (!user.avatarUrl && identity.avatarUrl) user.avatarUrl = identity.avatarUrl;
  try {
    await user.save();
  } catch (error) {
    // Two accounts connecting the same identity at once: the unique index
    // lets one through, and the other gets the answer the check above gives.
    if ((error as { code?: number }).code === 11000) {
      throw new ApiError(409, 'IDENTITY_IN_USE', `This ${label} already signs in to another VOKVE account.`, { provider: identity.provider, account: null });
    }
    throw error;
  }

  await AuditLogModel.create({
    actorType: 'user', actorId: user._id, deviceId: meta.deviceId,
    action: 'user.identity_linked', subjectType: 'user', subjectId: user._id, after: { provider: identity.provider },
  });
  await tell(user._id, `${PROVIDER_NAME[identity.provider]} sign-in connected`,
    `You can now sign in to VOKVE with ${PROVIDER_NAME[identity.provider]}. If this was not you, disconnect it under Account → Security and change your password.`);
  return signInMethodsOf(user);
}

/**
 * Takes an identity off the account, unless it is the last way in. An
 * account with no password and one provider would be locked out by this —
 * the member is told to set a password first, through Forgot password,
 * which proves the account's email the way sign-up did.
 *
 * Apple is confirmed with Apple first (RULES O16): that fresh sign-in is
 * both the proof that the member is letting go of their own Apple ID and
 * the authorisation code that lets the server revoke it, so VOKVE leaves
 * the member's "Sign in with Apple" list when it leaves their account.
 */
export async function unlinkIdentity(
  userId: string,
  provider: SignInProvider,
  apple: { idToken: string; nonce: string; authorizationCode: string } | undefined,
  meta: { deviceId?: string; platform?: string },
): Promise<SignInMethods> {
  const user = await liveUser(userId);
  const field = FIELD[provider];
  if (!user[field]) return signInMethodsOf(user);

  if (waysIn(user) <= 1) {
    throw new ApiError(
      409,
      'LAST_SIGN_IN_METHOD',
      `${PROVIDER_NAME[provider]} is the only way into this account. Set a password first — sign out and use Forgot password — so you can still sign in.`,
      { provider },
    );
  }

  let appleRevocation: RevocationResult | null = null;
  if (provider === 'apple') {
    if (!apple) {
      throw new ApiError(422, 'CONFIRMATION_REQUIRED', 'Confirm with Apple to disconnect it.', { confirmWith: 'apple' });
    }
    const identity = await verifyAppleIdToken(apple.idToken, apple.nonce);
    if (identity.appleId !== user.appleId) {
      throw new ApiError(403, 'APPLE_ID_MISMATCH', 'That is a different Apple ID from the one on this VOKVE account.');
    }
    appleRevocation = await revokeAppleAuthorization({
      code: apple.authorizationCode,
      clientId: identity.audience,
      webFlow: meta.platform === 'android',
      userId: user._id,
    });
  }

  user.set(field, undefined);
  await user.save();
  await AuditLogModel.create({
    actorType: 'user', actorId: user._id, deviceId: meta.deviceId,
    action: 'user.identity_unlinked', subjectType: 'user', subjectId: user._id, before: { provider }, after: { appleRevocation },
  });
  await tell(user._id, `${PROVIDER_NAME[provider]} sign-in disconnected`,
    `${PROVIDER_NAME[provider]} no longer signs in to your VOKVE account. If this was not you, change your password under Account → Security.`);
  return signInMethodsOf(user);
}

/**
 * The feed row that says the ways in changed — the one place a member
 * whose session was taken would see a stranger's Apple ID arrive. A
 * failure to write it never undoes the change it reports.
 */
async function tell(userId: string, title: string, message: string): Promise<void> {
  try {
    await notify({ userId, topic: 'system', title, message, exemptFromQuietHours: true });
  } catch (error) {
    logger.warn({ err: error, userId }, 'identity.notify_failed');
  }
}
