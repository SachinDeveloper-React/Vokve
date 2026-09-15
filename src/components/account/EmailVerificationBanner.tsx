import React, { memo, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { MailCheck } from 'lucide-react-native';
import { useTheme } from '../../theme';
import {
  useAuthStore,
  useIsEmailVerified,
  usePendingEmailVerification,
} from '../../stores/authStore';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';

interface Props {
  /** What verifying unlocks, in the user's terms — "redeem rewards". */
  reason?: string;
}

/**
 * The soft gate, made visible (D-20). A user who skipped the email code is
 * signed in and can use everything except spend and payout; this is where
 * the app says so, and offers the code again.
 *
 * Renders nothing once the email is verified, so it can sit permanently at
 * the top of the wallet and the shop without a screen having to decide.
 *
 * Two states: a live challenge means the code has already been sent and the
 * button just reopens the screen; none means a new one has to be requested
 * first — the root navigator opens the screen the moment it arrives.
 */
export const EmailVerificationBanner = memo(({ reason = 'redeem rewards' }: Props) => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const isVerified = useIsEmailVerified();
  const pending = usePendingEmailVerification();
  const requestEmailVerification = useAuthStore(s => s.requestEmailVerification);
  const isSubmitting = useAuthStore(s => s.isSubmitting);
  const email = useAuthStore(s => s.user?.email);

  const onPress = useCallback(() => {
    if (pending) {
      navigation.navigate('VerifyContact');
      return;
    }
    requestEmailVerification();
  }, [navigation, pending, requestEmailVerification]);

  if (isVerified) {
    return null;
  }

  return (
    <Box
      bg="card"
      radius="xl"
      p="base"
      bordered
      accessibilityRole="summary"
      accessibilityLabel={`Verify your email to ${reason}`}
    >
      <HStack gap="md" align="center">
        <Icon as={MailCheck} size="lg" tint={colors.warning} />
        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong">Verify your email</AppText>
          <AppText variant="caption" color="textSecondary" numberOfLines={2}>
            {`You need a verified email to ${reason}. ${
              pending ? 'We sent a code to' : 'We will send a code to'
            } ${email ?? 'your address'}.`}
          </AppText>
        </VStack>
        <Button
          label={pending ? 'Enter code' : 'Verify'}
          variant="brand"
          size="sm"
          loading={isSubmitting}
          disabled={isSubmitting}
          onPress={onPress}
        />
      </HStack>
    </Box>
  );
});

EmailVerificationBanner.displayName = 'EmailVerificationBanner';
