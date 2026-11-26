import React, { useCallback } from 'react';
import { BottomSheet } from '../disclosure/BottomSheet';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { useTheme } from '../../theme';
import { useAuthStore, usePendingIdentity } from '../../stores/authStore';
import { AppleMark, GoogleMark } from './SocialAuthRow';
import type { SignInProvider } from '../../types/models';

const PROVIDER_ID: Record<SignInProvider, string> = { google: 'Google account', apple: 'Apple ID', facebook: 'Facebook account' };
const PROVIDER_NAME: Record<SignInProvider, string> = { google: 'Google', apple: 'Apple', facebook: 'Facebook' };

interface Props {
  /**
   * After "I already have an account". The sign-in screen has nothing to
   * do — its form is already the next step; the sign-up screen sends the
   * member back to it.
   */
  onChoseExistingAccount?: () => void;
}

/**
 * The question asked before a Google, Apple or Facebook sign-in makes a
 * second account (RULES O15).
 *
 * Facebook always lands here for a member it does not know (O18): its
 * email is not proved, so it never finds their account on its own.
 *
 * The server found no account for the identity, which is either a new
 * member or a returning one whose account Google or Apple cannot point at —
 * most often an Apple member who chose Hide My Email, whose relay address
 * matches nothing. Only the member knows which, so they are asked, and
 * "I already have an account" keeps the identity until they sign in to it.
 */
export const IdentityChoiceSheet = ({ onChoseExistingAccount }: Props) => {
  const pending = usePendingIdentity();
  const isSubmitting = useAuthStore(s => s.isSubmitting);
  const createAccount = useAuthStore(s => s.createAccountFromIdentity);
  const keepForExisting = useAuthStore(s => s.keepIdentityForExistingAccount);
  const dismiss = useAuthStore(s => s.dismissPendingIdentity);
  const signInWithGoogle = useAuthStore(s => s.signInWithGoogle);
  const signInWithApple = useAuthStore(s => s.signInWithApple);
  const { colors } = useTheme();

  const onExisting = useCallback(() => {
    keepForExisting();
    onChoseExistingAccount?.();
  }, [keepForExisting, onChoseExistingAccount]);

  const onCreate = useCallback(() => {
    createAccount();
  }, [createAccount]);

  /**
   * "Continue with Google" on the welcome-back sheet: the identity waits
   * (`link`), the provider signs in to the account that has the email, and
   * the store connects the waiting identity the moment that session starts.
   */
  const continueWith = useCallback(
    (way: 'google' | 'apple') => {
      keepForExisting();
      if (way === 'google') {
        signInWithGoogle();
      } else {
        signInWithApple();
      }
    },
    [keepForExisting, signInWithApple, signInWithGoogle],
  );

  const visible = pending?.stage === 'choose';
  const provider = pending?.provider ?? 'apple';
  const existingAccount = pending?.existingAccount ?? null;

  // Facebook's email already belongs to an account (RULES O18) — the
  // "account exists with a different sign-in" case every large app meets.
  // Answered the way they answer it: welcome back, here is the button that
  // opens your account. One tap there signs in and connects Facebook, and
  // from then on Facebook opens that same account. A new account is not
  // offered: the server would refuse a second account for the address.
  if (existingAccount) {
    const name = PROVIDER_NAME[provider];
    const ways = (pending?.existingMethods ?? []).filter(
      (way): way is 'google' | 'apple' => way === 'google' || way === 'apple',
    );
    const hasPassword = pending?.existingMethods?.includes('password') ?? false;
    // Nothing named (an older server, or an account whose only way in is
    // another Facebook account): the sign-in form, which also has Forgot
    // password, is the way that always works.
    const showForm = hasPassword || ways.length === 0;
    const howList = [
      ...ways.map(way => PROVIDER_NAME[way]),
      ...(hasPassword ? ['your password'] : []),
    ];
    const how =
      howList.length > 1
        ? `${howList.slice(0, -1).join(', ')} or ${howList[howList.length - 1]}`
        : howList[0] ?? 'the way you usually do';
    return (
      <BottomSheet
        visible={visible}
        onClose={dismiss}
        title="Welcome back"
        dismissible={!isSubmitting}
      >
        <VStack gap="md" pb="base">
          <AppText variant="body" color="textSecondary">
            {`You already have a VOKVE account with ${existingAccount}.`}
          </AppText>
          <AppText variant="caption" color="textSecondary">
            {`Continue with ${how} once and we will connect ${name} to it. After that, ${name} opens the same account — your coins, streak and history stay together.`}
          </AppText>
          {ways.map((way, index) => (
            <Button
              key={way}
              label={`Continue with ${PROVIDER_NAME[way]}`}
              variant={index === 0 ? 'brand' : 'secondary'}
              fullWidth
              icon={way === 'google' ? <GoogleMark /> : <AppleMark color={colors.text} />}
              loading={isSubmitting}
              disabled={isSubmitting}
              onPress={() => continueWith(way)}
            />
          ))}
          {showForm ? (
            <Button
              label={hasPassword ? 'Sign in with email and password' : 'Sign in'}
              variant={ways.length === 0 ? 'brand' : 'secondary'}
              fullWidth
              disabled={isSubmitting}
              onPress={onExisting}
            />
          ) : null}
          <Button
            label="Not now"
            variant="ghost"
            fullWidth
            disabled={isSubmitting}
            onPress={dismiss}
          />
        </VStack>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={dismiss}
      title="New to VOKVE?"
      dismissible={!isSubmitting}
    >
      <VStack gap="md" pb="base">
        <AppText variant="body" color="textSecondary">
          {`There is no VOKVE account for this ${PROVIDER_ID[provider]} yet.`}
          {pending?.email ? ` ${PROVIDER_NAME[provider]} shared ${pending.email}.` : ''}
        </AppText>
        <AppText variant="caption" color="textSecondary">
          {`Used VOKVE before with your email, phone or another sign-in? Sign in to that account and we will connect ${PROVIDER_NAME[provider]} to it — your coins, streak and history stay in one place.`}
        </AppText>
        <Button
          label="Create a new account"
          variant="brand"
          fullWidth
          loading={isSubmitting}
          disabled={isSubmitting}
          onPress={onCreate}
        />
        <Button
          label="I already have an account"
          variant="secondary"
          fullWidth
          disabled={isSubmitting}
          onPress={onExisting}
        />
      </VStack>
    </BottomSheet>
  );
};

/** The line the sign-in screen shows while a pending identity waits for the account. */
export function pendingLinkNotice(provider: SignInProvider): { title: string; message: string } {
  const name = PROVIDER_NAME[provider];
  return {
    title: `Sign in to connect ${name}`,
    message: `Sign in to your existing account with your email, phone or another method. ${name} will be connected to it, and will open it from now on.`,
  };
}
