import React, { useCallback } from 'react';
import { BottomSheet } from '../disclosure/BottomSheet';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { useAuthStore, usePendingIdentity } from '../../stores/authStore';

const PROVIDER_ID = { google: 'Google account', apple: 'Apple ID' } as const;
const PROVIDER_NAME = { google: 'Google', apple: 'Apple' } as const;

interface Props {
  /**
   * After "I already have an account". The sign-in screen has nothing to
   * do — its form is already the next step; the sign-up screen sends the
   * member back to it.
   */
  onChoseExistingAccount?: () => void;
}

/**
 * The question asked before a Google or Apple sign-in makes a second account
 * (RULES O15).
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

  const onExisting = useCallback(() => {
    keepForExisting();
    onChoseExistingAccount?.();
  }, [keepForExisting, onChoseExistingAccount]);

  const onCreate = useCallback(() => {
    createAccount();
  }, [createAccount]);

  const visible = pending?.stage === 'choose';
  const provider = pending?.provider ?? 'apple';

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
export function pendingLinkNotice(provider: 'google' | 'apple'): { title: string; message: string } {
  const name = PROVIDER_NAME[provider];
  return {
    title: `Sign in to connect ${name}`,
    message: `Sign in to your existing account with your email, phone or another method. ${name} will be connected to it, and will open it from now on.`,
  };
}
