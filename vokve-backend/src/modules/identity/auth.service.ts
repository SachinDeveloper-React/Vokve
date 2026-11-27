import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { verifyAppleIdToken } from '../../lib/appleIdentity.js';
import { verifyFacebookProof, type FacebookProof } from '../../lib/facebookIdentity.js';
import { facebookProofChecks, facebookTokenFields, toFacebookProof } from './confirm.service.js';
import { verifyGoogleIdToken } from '../../lib/googleIdentity.js';
import { getConfig } from '../../config/remote.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { hashToken, IDENTITY_LINK_TTL_SECONDS, newRefreshToken, signAccessToken, signIdentityLinkToken, signStepUpToken } from '../../lib/tokens.js';
import { authResponseSchema, genderSchema, type AuthResponse } from '../../contracts/index.js';
import { clearPushToken, startCounting, stopCounting } from '../devices/service.js';
import { CoinBalanceModel } from '../economy/models.js';
import { AuditLogModel } from '../platform/models.js';
import { NotificationPreferencesModel, RefreshTokenModel, UserModel, UserSettingsModel, type UserDoc } from './models.js';
import { consumeChallenge, createChallenge, findLiveChallenge, isChannelDeliverable, isChannelUsable } from './otp.service.js';
import { phoneProvenElsewhere, releaseUnprovenPhone } from './phoneClaims.js';
import { claimUnprovenAccount } from './claim.service.js';
import { toUser } from './serialize.js';
import { identityFromLinkToken, maskEmail, PROVIDER_FIELD, PROVIDER_LABEL, PROVIDER_NAME, PROVIDER_PROVES_EMAIL, signInWaysOf, type ProviderIdentity, type SignInWay } from './linking.service.js';
import { applyCodeAtSignUp, findCode } from '../social/service.js';

// ─── Request shapes (mirror src/types/forms.ts on the client) ───────────────

export const signUpBody = z.object({
  email: z.string().trim().toLowerCase().email('That does not look like an email address'),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Enter a valid phone number'),
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(72, 'Passwords cannot be longer than 72 characters')
    .regex(/[A-Za-z]/, 'Include at least one letter')
    .regex(/\d/, 'Include at least one number'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select your date of birth'),
  gender: genderSchema,
  /** A friend's referral code, applied the moment the account exists (RULES F2). */
  referralCode: z.string().trim().min(4).max(12).optional(),
});
export type SignUpBody = z.infer<typeof signUpBody>;

export const signInBody = z.object({
  /** The client's field is called `email` but holds an email or a phone. */
  email: z.string().trim().min(1, 'Enter your email or phone number').max(254, 'That is too long for an email or phone number'),
  // Bounded: bcrypt reads 72 bytes and no more, and an unbounded string is
  // also an unbounded rate-limit key.
  password: z.string().min(1, 'Enter your password').max(256, 'That is too long for a password'),
});

export const verifyOtpBody = z.object({ verificationId: z.string().min(1).max(128), code: z.string().regex(/^\d{4,8}$/) });
export const resendOtpBody = z.object({ verificationId: z.string().min(1).max(128) });
export const refreshBody = z.object({ refreshToken: z.string().min(1).max(256) });
// Bounded: the identifier is also the key of a rate limit, and an email or a
// phone number is never longer than this.
export const otpRequestBody = z.object({ identifier: z.string().trim().min(1).max(254), purpose: z.enum(['login', 'reset_password']) });
export const resetPasswordBody = z.object({ verificationId: z.string().min(1), code: z.string().regex(/^\d{4,8}$/), password: signUpBody.shape.password });

/** How a session began (RULES O17). In-session codes inherit the session's own. */
export type SessionMethod = 'password' | 'otp' | 'google' | 'apple' | 'facebook';

interface Meta { deviceId?: string; ip?: string; appVersion?: string; method?: SessionMethod }

// ─── Sign-up → phone OTP → (account) → email OTP ───────────────────────────

export async function signUp(body: SignUpBody, meta: Meta) {
  const [byEmail, byPhone] = await Promise.all([
    UserModel.exists({ email: body.email }).collation({ locale: 'en', strength: 2 }),
    // Only a verified number is taken: an unverified one proves nothing and
    // reserved it for whoever typed it first (security audit 2026-11-27, M-1).
    phoneProvenElsewhere(body.phone),
  ]);
  const details: Record<string, string> = {};
  if (byEmail) details.email = await emailTakenMessage(body.email);
  if (byPhone) details['phone.number'] = 'That phone number is already registered.';
  // A bad code is refused here, on its field, while the form is still on
  // screen — not after the OTP, when the only thing left to do is shrug.
  const referralCode = body.referralCode ? await findCode(body.referralCode) : null;
  if (body.referralCode && !referralCode) details.referralCode = 'That code does not match anyone. Check it with your friend.';
  if (Object.keys(details).length) throw Errors.validation(details);

  // The account does not exist until one contact is proven; the payload
  // rides on the challenge (RULES O3). The hash is computed now so a verified
  // challenge can create the user without the password in the document.
  //
  // Which contact goes first is config: email while there is no SMS
  // provider, phone once there is. If the configured channel cannot deliver
  // at all, the other one is used rather than sending nothing.
  const { otp } = await getConfig();
  const channel = isChannelUsable(otp.signupChannel) ? otp.signupChannel : otp.signupChannel === 'email' ? 'sms' : 'email';
  const passwordHash = await bcrypt.hash(body.password, 12);
  return createChallenge({
    channel,
    purpose: 'signup',
    target: channel === 'email' ? body.email : body.phone,
    payload: { email: body.email, phone: body.phone, passwordHash, dateOfBirth: body.dateOfBirth, gender: body.gender, referralCode },
    deviceId: meta.deviceId,
    ip: meta.ip,
  });
}

/**
 * "Already registered", said the way large apps say it: with the way that
 * account signs in, so somebody who joined with Google a month ago is
 * pointed at the Google button instead of guessing at a password they
 * never had.
 */
async function emailTakenMessage(email: string): Promise<string> {
  const holder = await UserModel.findOne({ email }, { passwordHash: 1, googleId: 1, appleId: 1, facebookId: 1 }).collation({ locale: 'en', strength: 2 }).lean();
  const ways = holder ? signInWaysOf(holder) : [];
  if (ways.length === 0 || ways.includes('password')) return 'That email address is already registered. Sign in instead.';
  return `That email address is already registered with ${joinWays(ways)}. Continue with ${WAY_NAME[ways[0]!]} instead.`;
}

const WAY_NAME: Record<SignInWay, string> = { password: 'a password', google: 'Google', apple: 'Apple', facebook: 'Facebook' };
const joinWays = (ways: SignInWay[]) =>
  ways.length === 1 ? WAY_NAME[ways[0]!] : `${ways.slice(0, -1).map(w => WAY_NAME[w]).join(', ')} or ${WAY_NAME[ways[ways.length - 1]!]}`;

export async function resendOtp(verificationId: string, meta: Meta) {
  const previous = await findLiveChallenge(verificationId);
  return createChallenge({
    channel: previous.channel as 'sms' | 'email',
    purpose: previous.purpose as never,
    target: previous.target,
    userId: previous.userId,
    payload: previous.payload,
    deviceId: meta.deviceId,
    ip: meta.ip,
    previous: { _id: previous._id, resends: previous.resends, resendAfter: previous.resendAfter, decoy: previous.decoy },
  });
}

/**
 * One endpoint, polymorphic on purpose (RULES O2). Every branch ends in a
 * session so the client has one screen and one call.
 */
export async function verifyOtp(verificationId: string, code: string, meta: Meta): Promise<AuthResponse> {
  const challenge = await consumeChallenge(verificationId, code);

  switch (challenge.purpose) {
    case 'signup': {
      const p = challenge.payload as { email: string; phone: string; passwordHash: string; dateOfBirth: string; gender: string; referralCode?: string | null };
      const config = await getConfig();
      const userId = newId('usr');
      const provenEmail = challenge.channel === 'email';
      // The number comes off any account that only typed it, as sign-up's
      // check promised (M-1). One that was verified since still refuses
      // below, through the unique index.
      await releaseUnprovenPhone(p.phone, null, 'signup');
      try {
        await UserModel.create({
          _id: userId, email: p.email, phone: p.phone, passwordHash: p.passwordHash,
          dateOfBirth: p.dateOfBirth, gender: p.gender,
          emailVerifiedAt: provenEmail ? new Date() : null,
          phoneVerifiedAt: provenEmail ? null : new Date(),
          country: config.locale.country, timezone: config.locale.timezone,
          trust: { score: config.trust.newAccountScore, tier: 'normal', updatedAt: new Date() },
        });
      } catch (error) {
        if ((error as { code?: number }).code === 11000) {
          throw new ApiError(409, 'ALREADY_REGISTERED', 'This number or email was registered a moment ago. Try signing in.');
        }
        throw error;
      }
      await Promise.all([
        UserSettingsModel.create({ _id: userId }),
        NotificationPreferencesModel.create({ _id: userId }),
        CoinBalanceModel.create({ _id: userId }),
        AuditLogModel.create({ actorType: 'user', actorId: userId, deviceId: meta.deviceId, action: 'user.signup', subjectType: 'user', subjectId: userId }),
      ]);
      // The friend's code the form carried: the referral opens the moment
      // the account does, so the inviter sees them join right away.
      if (p.referralCode) {
        await applyCodeAtSignUp(userId, p.referralCode, config.locale.timezone, meta.deviceId);
      }
      const user = (await UserModel.findById(userId))!;
      const session = await issueSession(user, { ...meta, method: 'password' });
      // The other contact is proven the same way, right after (RULES O4) —
      // sent now so the app can ask for it without another round-trip. Only
      // if that channel can actually deliver: a code nobody can receive is
      // worse than none, and the banner asks again once it can.
      const secondary: 'sms' | 'email' = provenEmail ? 'sms' : 'email';
      if (!isChannelDeliverable(secondary)) {
        return session;
      }
      const nextVerification = await createChallenge({
        channel: secondary, purpose: provenEmail ? 'verify_phone' : 'verify_email',
        target: provenEmail ? phoneOf(user) : user.email, userId, deviceId: meta.deviceId, ip: meta.ip,
      });
      return { ...session, nextVerification };
    }
    case 'verify_phone': {
      const user = await UserModel.findById(challenge.userId);
      if (!user) throw Errors.unauthorized();
      if (user.phone !== challenge.target) throw new ApiError(409, 'PHONE_CHANGED', 'Your number changed since this code was sent. Request a new one.');
      user.phoneVerifiedAt = new Date();
      await user.save();
      await AuditLogModel.create({ actorType: 'user', actorId: user._id, deviceId: meta.deviceId, action: 'user.phone_verified', subjectType: 'user', subjectId: user._id });
      return issueSession(user, meta);
    }
    case 'verify_email': {
      const user = await UserModel.findById(challenge.userId);
      if (!user) throw Errors.unauthorized();
      if (user.email !== challenge.target) throw new ApiError(409, 'EMAIL_CHANGED', 'Your email changed since this code was sent. Request a new one.');
      user.emailVerifiedAt = new Date();
      await user.save();
      await AuditLogModel.create({ actorType: 'user', actorId: user._id, deviceId: meta.deviceId, action: 'user.email_verified', subjectType: 'user', subjectId: user._id });
      return issueSession(user, meta);
    }
    case 'login': {
      const user = await UserModel.findById(challenge.userId);
      if (!user || user.deletedAt) throw Errors.unauthorized();
      // A code read from the inbox proves the address: an account that had
      // never proved it becomes this person's alone (H-1).
      if (challenge.channel === 'email' && !user.emailVerifiedAt) {
        await claimUnprovenAccount(user, 'email_code', meta);
        await user.save();
      }
      await signedInOn(user, meta);
      return issueSession(user, { ...meta, method: 'otp' });
    }
    case 'step_up': {
      // A second factor for one action (RULES O8): the session is refreshed
      // like any other verification, and the token that rides with it is
      // what the sensitive endpoint asks for.
      const user = await UserModel.findById(challenge.userId);
      if (!user || user.deletedAt) throw Errors.unauthorized();
      await AuditLogModel.create({ actorType: 'user', actorId: user._id, deviceId: meta.deviceId, action: 'user.step_up', subjectType: 'user', subjectId: user._id });
      const session = await issueSession(user, meta);
      return { ...session, stepUpToken: signStepUpToken(user._id) };
    }
    case 'change_phone':
    case 'change_email': {
      const user = await UserModel.findById(challenge.userId);
      if (!user) throw Errors.unauthorized();
      const next = (challenge.payload as { next: string }).next;
      if (challenge.purpose === 'change_email') {
        user.email = next;
        user.emailVerifiedAt = new Date();
      } else {
        // Proved by this code: any account that only typed it lets go (M-1).
        await releaseUnprovenPhone(next, user._id, 'changed');
        user.phone = next;
        user.phoneVerifiedAt = new Date();
      }
      try {
        await user.save();
      } catch (error) {
        if ((error as { code?: number }).code === 11000) throw Errors.validation({ [challenge.purpose === 'change_email' ? 'email' : 'phone']: 'That is already registered.' });
        throw error;
      }
      await AuditLogModel.create({ actorType: 'user', actorId: user._id, deviceId: meta.deviceId, action: `user.${challenge.purpose}`, subjectType: 'user', subjectId: user._id, after: { [challenge.purpose === 'change_email' ? 'email' : 'phone']: next } });
      return issueSession(user, meta);
    }
    default:
      throw new ApiError(400, 'OTP_WRONG_PURPOSE', 'This code cannot be used here.');
  }
}

// ─── Password sign-in ───────────────────────────────────────────────────────

export async function signIn(identifier: string, password: string, meta: Meta): Promise<AuthResponse> {
  const user = await findByIdentifier(identifier);
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : await bcrypt.compare(password, DUMMY_HASH);
  if (!user || !ok || user.deletedAt) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'That email or phone and password do not match.');
  }
  // One proven contact is enough to sign in; both are needed to spend (RULES O5).
  if (!user.phoneVerifiedAt && !user.emailVerifiedAt) {
    throw new ApiError(403, 'CONTACT_NOT_VERIFIED', 'Verify your email or phone number to continue.');
  }
  await signedInOn(user, meta);
  return issueSession(user, { ...meta, method: 'password' });
}

/**
 * Signing in with Google (RULES O12).
 *
 * The phone sends an ID token and nothing else is believed — the email,
 * the name and the id are all read out of the token after Google's
 * signature has been checked. A client that posted somebody else's email
 * would otherwise be signing in as them.
 *
 * Matched on `googleId` first and the email only after, because the id is
 * Google's stable `sub` and an email is not: addresses are changed, given
 * up and reissued. Matching on email at all is safe only because the
 * verifier refuses a token whose address Google has not itself proved —
 * without that check, anyone could sign up to Google with an address they
 * do not own and arrive here asking to be let into the matching account.
 *
 * A new account arrives with a verified email, no phone and a password
 * nobody can present. That is a shape the rules already know: one proven
 * contact is enough to sign in, and two are needed to spend (O5), so a
 * Google member walks and earns from the first minute and is asked for a
 * number when they come to spend.
 */
export async function signInWithGoogle(idToken: string, meta: Meta, ifNew: IfNew = 'create'): Promise<AuthResponse> {
  return signInWithIdentity(await googleIdentity(idToken), ifNew, meta);
}

/** A Google ID token, verified, as the identity sign-in and linking both take. */
export async function googleIdentity(idToken: string): Promise<ProviderIdentity> {
  const identity = await verifyGoogleIdToken(idToken);
  return {
    provider: 'google',
    providerId: identity.googleId,
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.picture,
  };
}

/**
 * Signing in with Apple (RULES O13).
 *
 * The Google rule, with Apple's two differences. Only the token says who
 * this is: the account is matched on `appleId` (the token's `sub`) and
 * then on the token's *verified* email. The one thing taken from the body
 * is the member's name, because Apple hands it to the app once — on the
 * very first authorisation — and never puts it in a token; it is a
 * display name the member could type into their profile anyway, so it
 * names a new account and fills an empty one, and never renames anybody.
 *
 * The email may be a private relay address. It still matches only the
 * account that was created from it, which is right: a member who hid
 * their address from us has not told us which password account is
 * theirs. And it may be missing altogether — Apple leaves it out when
 * the app was first authorised without the email scope — which is fine
 * for a member we already know by `appleId`, and the one case we cannot
 * make an account for, since every account needs an address.
 */
export const appleBody = z
  .object({
    idToken: z.string().trim().min(1).max(4000),
    /** The raw nonce the phone made; the token carries its SHA-256. */
    nonce: z.string().trim().min(16).max(128),
    fullName: z
      .object({
        givenName: z.string().trim().max(60).nullish(),
        familyName: z.string().trim().max(60).nullish(),
      })
      .strict()
      .nullish(),
    ifNew: z.enum(['create', 'ask']).optional(),
  })
  .strict();
export type AppleBody = z.infer<typeof appleBody>;

export async function signInWithApple(body: AppleBody, meta: Meta): Promise<AuthResponse> {
  return signInWithIdentity(await appleIdentity(body), body.ifNew ?? 'create', meta);
}

/** An Apple identity token, verified against its nonce, plus the once-only name. */
export async function appleIdentity(body: Pick<AppleBody, 'idToken' | 'nonce' | 'fullName'>): Promise<ProviderIdentity> {
  const identity = await verifyAppleIdToken(body.idToken, body.nonce);
  return {
    provider: 'apple',
    providerId: identity.appleId,
    email: identity.email,
    name: displayName(body.fullName),
    avatarUrl: null,
  };
}

/**
 * Signing in with Facebook (RULES O18).
 *
 * The phone sends the access token Facebook Login gave it, and the server
 * asks Facebook who that is (`lib/facebookIdentity`) — the token is not a
 * signed statement the way Google's and Apple's are, so there is nothing
 * to check locally. Matched on the app-scoped id **only**: Facebook does
 * not say whether it proved the address it shares, so the address never
 * finds an existing account — a member who already has one answers "I
 * already have an account" and signs in to it, or connects Facebook from
 * Security. A new account takes the address unproved, and is asked for a
 * code before it can redeem, the way every unproved address is (O5).
 *
 * No picture: Facebook's are signed CDN links that stop working within
 * days, and a profile photo that turns into a broken image is worse than
 * the initials.
 */
export const facebookBody = facebookProofChecks(
  z.object({ ...facebookTokenFields, ifNew: z.enum(['create', 'ask']).optional() }).strict(),
).transform(v => ({ proof: toFacebookProof(v), ifNew: v.ifNew }));

export async function signInWithFacebook(proof: FacebookProof, meta: Meta, ifNew: IfNew = 'create'): Promise<AuthResponse> {
  return signInWithIdentity(await facebookIdentity(proof), ifNew, meta);
}

/** A Facebook login — Android's access token or iOS's Limited Login token — verified, as sign-in and linking both take it. */
export async function facebookIdentity(proof: FacebookProof): Promise<ProviderIdentity> {
  const identity = await verifyFacebookProof(proof);
  return {
    provider: 'facebook',
    providerId: identity.facebookId,
    email: identity.email,
    name: identity.name,
    avatarUrl: null,
  };
}

/**
 * What a new client asks for when an identity matches no account: `create`
 * makes one, as every build before RULES O15 expects; `ask` answers
 * `IDENTITY_NOT_LINKED` with a link token instead, so the member can say
 * whether they already have an account before a second one exists.
 */
export type IfNew = 'create' | 'ask';

/**
 * The sign-in half of O12 and O13, which is the same for both providers.
 *
 * Matched on the provider's id first and its verified email after. An
 * email match is linked rather than refused — unless that account already
 * holds a different id from the same provider, which is left where it is:
 * the email proves the member, and overwriting would lock the other
 * identity out. No match at all either makes the account or, when the
 * phone asked to be asked, hands back a link token and lets the member
 * choose (O15).
 */
async function signInWithIdentity(identity: ProviderIdentity, ifNew: IfNew, meta: Meta): Promise<AuthResponse> {
  const field = PROVIDER_FIELD[identity.provider];
  let user = await UserModel.findOne({ [field]: identity.providerId });

  // A deleted account lets go of the identity, as connecting one already
  // does (O15): nobody can sign in to an anonymised row, and an id left on
  // it kept its owner out of VOKVE for good — every later press of the
  // same button answered "password does not match". They start afresh.
  if (user?.deletedAt) {
    await UserModel.updateOne({ _id: user._id }, { $unset: { [field]: 1 } });
    user = null;
  }

  // Only an address the provider itself proved may find an account
  // (Facebook's may not, O18).
  if (!user && identity.email && PROVIDER_PROVES_EMAIL[identity.provider]) {
    // Case-insensitive, with the same collation the unique index uses, or
    // `Someone@gmail.com` would make a second account beside `someone@`.
    user = await UserModel.findOne({ email: identity.email }).collation({ locale: 'en', strength: 2 });
    if (user && !user.deletedAt) {
      // An account whose address was never proved is not the account of
      // whoever made it — it is the address's, and this provider just
      // proved who has that (security audit 2026-11-27, H-1). Every way in
      // that skipped the proof goes before the provider is linked.
      if (!user.emailVerifiedAt) {
        await claimUnprovenAccount(user, identity.provider === 'apple' ? 'apple' : 'google', meta);
      }
      // Linking rather than refusing: somebody who signed up with a
      // password and later presses the provider's button means to reach
      // the same account, and telling them "that email is taken" by their
      // own account is the most confusing answer there is.
      if (!user[field]) user.set(field, identity.providerId);
      user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
      if (!user.avatarUrl && identity.avatarUrl) user.avatarUrl = identity.avatarUrl;
      if (!user.name && identity.name) user.name = identity.name;
      await user.save();
    }
  }

  if (user?.deletedAt) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'That email or phone and password do not match.');
  }

  if (!user) {
    // An address the provider did not prove (Facebook's, O18) that an
    // account already has: not linked on its say-so, but not a stranger
    // either. Named, masked, so the app can say "sign in to it once"
    // rather than offering a new account that would be refused.
    const holder = identity.email && !PROVIDER_PROVES_EMAIL[identity.provider]
      ? await UserModel.findOne({ email: identity.email }, { email: 1, passwordHash: 1, googleId: 1, appleId: 1, facebookId: 1 }).collation({ locale: 'en', strength: 2 }).lean()
      : null;
    // The other ways into that account, so the app can offer the one that
    // opens it ("Continue with Google") rather than a form to puzzle over.
    // Its own provider is left out: an account that already holds a
    // different Facebook account cannot take this one too (O15).
    const existingMethods = holder ? signInWaysOf(holder).filter(way => way !== identity.provider) : [];
    if (ifNew === 'ask') {
      throw new ApiError(
        409,
        'IDENTITY_NOT_LINKED',
        holder
          ? `There is already a VOKVE account for ${maskEmail(holder.email)}. Sign in to it once and ${PROVIDER_NAME[identity.provider]} will open it from then on.`
          : `There is no VOKVE account for this ${PROVIDER_LABEL[identity.provider]} yet.`,
        {
          provider: identity.provider,
          email: identity.email,
          existingAccount: holder ? maskEmail(holder.email) : null,
          existingMethods,
          linkToken: signIdentityLinkToken(identity),
          expiresInSeconds: IDENTITY_LINK_TTL_SECONDS,
        },
      );
    }
    if (!identity.email) {
      if (identity.provider === 'facebook') {
        throw new ApiError(
          401,
          'FACEBOOK_EMAIL_MISSING',
          'Facebook did not share an email address with VOKVE, and every account needs one. Try again and allow your email address, or sign up with your email and connect Facebook later under Account → Security.',
        );
      }
      throw new ApiError(
        401,
        'APPLE_EMAIL_MISSING',
        'Apple did not share an email address for this account. Stop using Sign in with Apple for VOKVE (on an iPhone: Settings → your name → Sign in with Apple; anywhere else: account.apple.com), then try again and share an email.',
      );
    }
    if (!PROVIDER_PROVES_EMAIL[identity.provider]) {
      // An address that is not proved cannot join the account that has it,
      // and cannot be taken from it either: the member signs in to that
      // account and connects the provider there (O15, O18).
      if (holder) {
        throw new ApiError(
          409,
          'EMAIL_ALREADY_REGISTERED',
          `There is already a VOKVE account for ${maskEmail(holder.email)}. Sign in to it the way you usually do, then connect ${PROVIDER_NAME[identity.provider]} under Account → Security.`,
          { provider: identity.provider, account: maskEmail(holder.email) },
        );
      }
    }
    user = await createProviderUser(
      { provider: identity.provider, providerId: identity.providerId, email: identity.email, name: identity.name, avatarUrl: identity.avatarUrl },
      meta,
    );
  }

  await signedInOn(user, meta);
  return issueSession(user, { ...meta, method: identity.provider });
}

/**
 * "Create a new account" after `IDENTITY_NOT_LINKED` (RULES O15): the
 * identity the link token holds, signed in as if it had just been
 * presented with `create`. If an account for it appeared in between, this
 * signs in to that one rather than making a second.
 */
export async function createFromLinkToken(linkToken: string, meta: Meta): Promise<AuthResponse> {
  return signInWithIdentity(identityFromLinkToken(linkToken), 'create', meta);
}

/** "Rana" + "Jay" → "Rana Jay"; nothing usable → null. Same bounds as `PATCH /me`. */
function displayName(fullName: AppleBody['fullName']): string | null {
  const joined = [fullName?.givenName, fullName?.familyName]
    .filter(part => typeof part === 'string' && part.length > 0)
    .join(' ')
    .trim()
    .slice(0, 60);
  return joined.length >= 2 ? joined : null;
}

/**
 * A brand-new account from a provider's token (Google, O12; Apple, O13;
 * Facebook, O18).
 *
 * The password hash is a string bcrypt can never match, the way a deleted
 * account's is: it keeps the field a string for the six places that
 * compare against it, and means the password sign-in simply does not
 * match rather than needing a special case at each one. Somebody who
 * wants a password can set one through the ordinary reset, which proves
 * the same address the provider just did.
 */
async function createProviderUser(
  account: {
    provider: ProviderIdentity['provider'];
    providerId: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  },
  meta: Meta,
): Promise<UserDoc> {
  const config = await getConfig();
  const userId = newId('usr');
  const idField = PROVIDER_FIELD[account.provider];

  let user: UserDoc;
  try {
    user = await UserModel.create({
      _id: userId,
      email: account.email,
      [idField]: account.providerId,
      passwordHash: `${account.provider}:${account.providerId}`,
      name: account.name ?? '',
      avatarUrl: account.avatarUrl,
      // Google and Apple proved the address; Facebook only reported it (O18).
      emailVerifiedAt: PROVIDER_PROVES_EMAIL[account.provider] ? new Date() : null,
      phoneVerifiedAt: null,
      country: config.locale.country,
      timezone: config.locale.timezone,
      trust: { score: config.trust.newAccountScore, tier: 'normal', updatedAt: new Date() },
    });
  } catch (error) {
    // Two taps of the button at once. The second read finds what the
    // first wrote rather than answering "already registered" to somebody
    // who is doing nothing wrong.
    if ((error as { code?: number }).code === 11000) {
      const existing = await UserModel.findOne({ [idField]: account.providerId });
      if (existing) return existing;
    }
    throw error;
  }

  await Promise.all([
    UserSettingsModel.create({ _id: userId }),
    NotificationPreferencesModel.create({ _id: userId }),
    CoinBalanceModel.create({ _id: userId }),
    AuditLogModel.create({
      actorType: 'user', actorId: userId, deviceId: meta.deviceId,
      action: `user.signup_${account.provider}`, subjectType: 'user', subjectId: userId,
    }),
  ]);

  return user;
}

/**
 * Signing in again on an install this account already has: its steps count
 * from now (D-56). Only a sign-in — a code or a step-up taken while signed
 * in leaves counting as it is. An install that is another account's, or
 * new, starts when it registers; a period still open simply carries on.
 */
async function signedInOn(user: UserDoc, meta: Meta): Promise<void> {
  if (meta.deviceId) await startCounting(user._id, meta.deviceId, new Date(), meta.appVersion);
}

/** Constant-time-ish: always run one bcrypt compare so a missing user is not faster. */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5aKq3wHjJ7a1pQd9dfZKQv0Xw1ZbUeq';

export async function findByIdentifier(identifier: string): Promise<UserDoc | null> {
  const value = identifier.trim();
  if (value.includes('@')) {
    return UserModel.findOne({ email: value.toLowerCase() }).collation({ locale: 'en', strength: 2 });
  }
  const digits = value.replace(/[\s-]/g, '');
  return UserModel.findOne({ phone: digits.startsWith('+') ? digits : `+${digits}` });
}

// ─── Passwordless / reset ───────────────────────────────────────────────────

export async function requestOtp(identifier: string, purpose: 'login' | 'reset_password', meta: Meta) {
  const user = await findByIdentifier(identifier);
  const channel = identifier.includes('@') ? 'email' : 'sms';
  // Never reveal whether an account exists (RULES O9): an unknown identifier
  // gets a decoy challenge — stored, rate-limited and masked exactly like a
  // real one, but never delivered — so the response and every later error
  // are the same either way.
  const target = user
    ? channel === 'email'
      ? user.email
      : phoneOf(user)
    : normaliseIdentifier(identifier, channel);
  return createChallenge({
    channel, purpose, target, userId: user?._id ?? null, deviceId: meta.deviceId, ip: meta.ip, decoy: !user,
  });
}

function normaliseIdentifier(identifier: string, channel: 'sms' | 'email'): string {
  const value = identifier.trim();
  if (channel === 'email') return value.toLowerCase();
  const digits = value.replace(/[\s-]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}

/** Changing a contact detail proves the *new* one first (RULES O7). */
export async function requestContactChange(userId: string, kind: 'phone' | 'email', newValue: string, meta: Meta) {
  const user = await UserModel.findById(userId);
  if (!user) throw Errors.unauthorized();
  const channel = kind === 'email' ? 'email' : 'sms';
  const target = normaliseIdentifier(newValue, channel);
  // The same two rules sign-up applies, which this route never did: any
  // string of three characters was taken as the new contact, sent to the
  // mailer as a recipient — where `a@x.com, b@y.com` is two of them — and
  // written to the account once the code came back.
  const wellFormed = kind === 'email'
    ? signUpBody.shape.email.safeParse(target).success
    : signUpBody.shape.phone.safeParse(target).success;
  if (!wellFormed) {
    throw Errors.validation({ [kind]: kind === 'email' ? 'That does not look like an email address' : 'Enter a valid phone number' });
  }
  if ((kind === 'email' && target === user.email) || (kind === 'phone' && target === user.phone)) {
    throw new ApiError(422, 'SAME_CONTACT', `That is already your ${kind}.`);
  }
  const taken = kind === 'email'
    ? await UserModel.exists({ email: target }).collation({ locale: 'en', strength: 2 })
    : await phoneProvenElsewhere(target, userId);
  if (taken) throw Errors.validation({ [kind]: `That ${kind} is already registered.` });
  return createChallenge({
    channel, purpose: kind === 'email' ? 'change_email' : 'change_phone', target, userId, payload: { next: target },
    deviceId: meta.deviceId, ip: meta.ip,
  });
}

export async function resetPassword(verificationId: string, code: string, password: string) {
  const challenge = await consumeChallenge(verificationId, code, ['reset_password']);
  // A decoy can only reach here if its undelivered code was guessed — treat it as a wrong code, not a clue.
  const user = challenge.userId ? await UserModel.findById(challenge.userId) : null;
  if (!user) throw new ApiError(422, 'OTP_INVALID', 'That code is not right. Check it and try again.');
  // The code came from the inbox, so the address is proved: an account that
  // never proved it keeps no way in but this new password (H-1).
  if (challenge.channel === 'email' && !user.emailVerifiedAt) {
    await claimUnprovenAccount(user, 'password_reset');
  }
  user.passwordHash = await bcrypt.hash(password, 12);
  await user.save();
  await RefreshTokenModel.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return { ok: true };
}

// ─── Sessions ───────────────────────────────────────────────────────────────

export async function issueSession(user: UserDoc, meta: Meta): Promise<AuthResponse> {
  // Every caller has just been proved — a sign-in, or a code passed inside
  // the session — so this is the moment the session was proved (O22).
  const authAt = new Date();
  const access = signAccessToken({ sub: user._id, tier: user.trust?.tier ?? 'normal', auth: Math.floor(authAt.getTime() / 1000) });
  const refresh = newRefreshToken();
  // A code passed inside a session (a step-up, a contact change) issues a
  // fresh row for the same phone: it is the same session, begun the same way.
  const method = meta.method ?? (await sessionMethodOn(user._id, meta.deviceId));
  await RefreshTokenModel.create({
    userId: user._id,
    deviceId: meta.deviceId ?? null,
    tokenHash: refresh.hash,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    method,
    authAt,
  });
  return authResponseSchema.parse({
    user: toUser(user),
    tokens: { accessToken: access.token, refreshToken: refresh.token, expiresAt: access.expiresAt },
    emailVerification: null,
  });
}

/** How the live session on this phone began, for a row issued inside it. */
async function sessionMethodOn(userId: string, deviceId: string | undefined): Promise<string | null> {
  if (!deviceId) return null;
  const live = await RefreshTokenModel.findOne({ userId, deviceId, revokedAt: null }, { method: 1 }).sort({ createdAt: -1 }).lean();
  return live?.method ?? null;
}

/**
 * Rotation with a grace window (RULES Z1): the old token is marked superseded
 * rather than deleted, and is honoured for 30 s so a request that raced the
 * refresh can still replay. A token presented from a different device than
 * the one it was bound to is treated as theft (RULES DV7).
 */
export async function refreshSession(refreshToken: string, meta: Meta) {
  const hash = hashToken(refreshToken);
  const row = await RefreshTokenModel.findOne({ tokenHash: hash });
  if (!row || row.expiresAt < new Date()) throw Errors.unauthorized();
  if (row.revokedAt) throw Errors.unauthorized();
  if (row.supersededBy) {
    const graceUntil = (row.updatedAt?.getTime() ?? 0) + 30_000;
    if (Date.now() > graceUntil) {
      // Reuse after grace: revoke the whole family.
      await RefreshTokenModel.updateMany({ userId: row.userId, deviceId: row.deviceId }, { $set: { revokedAt: new Date() } });
      throw Errors.unauthorized();
    }
  }
  // A token bound to a device is answered only for that device. A refresh
  // naming no device at all used to skip the check, so a token lifted off a
  // phone worked anywhere by leaving the header out (security audit
  // 2026-11-27, L-1); the app has sent the header on refresh since.
  if (row.deviceId && row.deviceId !== meta.deviceId) {
    await RefreshTokenModel.updateOne({ _id: row._id }, { $set: { revokedAt: new Date() } });
    await AuditLogModel.create({ actorType: 'system', action: 'session.device_mismatch', subjectType: 'user', subjectId: row.userId, deviceId: meta.deviceId, before: { boundTo: row.deviceId } });
    throw Errors.unauthorized();
  }
  const user = await UserModel.findById(row.userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();

  // A refresh proves nothing new: the session keeps the time it was last
  // proved, so a token that is merely kept alive never reads as a fresh
  // sign-in (O22).
  const authAt = row.authAt ?? null;
  const access = signAccessToken({
    sub: user._id, tier: user.trust?.tier ?? 'normal',
    ...(authAt ? { auth: Math.floor(authAt.getTime() / 1000) } : {}),
  });
  const next = newRefreshToken();
  const created = await RefreshTokenModel.create({
    userId: user._id, deviceId: row.deviceId ?? meta.deviceId ?? null, tokenHash: next.hash,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    method: row.method ?? null,
    authAt,
  });
  if (!row.supersededBy) {
    await RefreshTokenModel.updateOne({ _id: row._id }, { $set: { supersededBy: created._id.toString() } });
  }
  return { accessToken: access.token, refreshToken: next.token, expiresAt: access.expiresAt };
}

export async function signOut(userId: string, deviceId?: string) {
  const filter = deviceId ? { userId, deviceId, revokedAt: null } : { userId, revokedAt: null };
  await RefreshTokenModel.updateMany(filter, { $set: { revokedAt: new Date() } });
  // Signed out, the phone stops counting for this account (D-56).
  await stopCounting(userId, deviceId ? { deviceId } : {});
  // And stops being addressable as it (RULES DV7). The FCM token belongs to
  // the install: the next account to sign in on this phone is handed the
  // same string, so a token left on this row is this account's notifications
  // arriving on somebody else's phone. The app withdraws it too, but over a
  // network that may not be there.
  await clearPushToken(userId, deviceId);
  return { ok: true };
}

/**
 * Starts a step-up (RULES O8): a code to the email, which is the channel
 * that delivers today. Only a user with a proven email can be asked — a
 * code sent to an address nobody has confirmed proves nothing.
 */
export async function requestStepUp(userId: string, meta: Meta) {
  const user = await UserModel.findById(userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();
  if (!user.emailVerifiedAt) throw Errors.forbidden('EMAIL_NOT_VERIFIED', 'Verify your email address first.');
  return createChallenge({ channel: 'email', purpose: 'step_up', target: user.email, userId, deviceId: meta.deviceId, ip: meta.ip });
}

export async function sendEmailOtp(userId: string, meta: Meta) {
  const user = await UserModel.findById(userId);
  if (!user) throw Errors.unauthorized();
  if (user.emailVerifiedAt) throw new ApiError(409, 'EMAIL_ALREADY_VERIFIED', 'Your email is already verified.');
  if (!isChannelUsable('email')) throw new ApiError(503, 'EMAIL_UNAVAILABLE', 'Email is not available right now.');
  return createChallenge({ channel: 'email', purpose: 'verify_email', target: user.email, userId, deviceId: meta.deviceId, ip: meta.ip });
}

export async function sendPhoneOtp(userId: string, meta: Meta) {
  const user = await UserModel.findById(userId);
  if (!user) throw Errors.unauthorized();
  if (user.phoneVerifiedAt) throw new ApiError(409, 'PHONE_ALREADY_VERIFIED', 'Your number is already verified.');
  if (!isChannelDeliverable('sms')) throw new ApiError(503, 'SMS_UNAVAILABLE', 'Text messages are not available yet. You can verify your number later.');
  return createChallenge({ channel: 'sms', purpose: 'verify_phone', target: phoneOf(user), userId, deviceId: meta.deviceId, ip: meta.ip });
}

/**
 * The account's phone, where it has one.
 *
 * An account that arrived through Google or Apple has none (RULES O12,
 * O13), and every caller here is about to send it a text. Refusing in
 * words is the point: without this the number is `undefined`, the code
 * goes nowhere, and the member waits for a message that was never
 * addressed to anybody.
 */
function phoneOf(user: UserDoc): string {
  if (!user.phone) {
    throw new ApiError(
      409,
      'NO_PHONE_ON_ACCOUNT',
      'There is no phone number on this account yet. Add one in your profile first.',
    );
  }
  return user.phone;
}
