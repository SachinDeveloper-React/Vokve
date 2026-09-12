import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft } from 'lucide-react-native';
import {
  Alert,
  AppText,
  Box,
  Button,
  Center,
  Divider,
  HStack,
  Icon,
  OtpInput,
  OtpSafetyNote,
  Pressable,
  ResendOtpRow,
  Screen,
  VerificationHeroArt,
  VStack,
  Wordmark,
  type OtpInputHandle,
} from '../../components';
import { useCountdown } from '../../hooks';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { useAuthStore } from '../../stores/authStore';
import { formatCountdown, formatPhoneNumber } from '../../utils/format';
import type { AuthStackParamList } from '../../types/navigation';

/**
 * The two rules the layout primitives cannot express: `letterSpacing`, which
 * has no token behind it, and the scroll view's growth, which takes a style
 * object rather than a component.
 */
const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  tagline: { letterSpacing: 2.4 },
  // Matches the back arrow's icon width. `Spacer` cannot do this: it flexes to
  // fill, which would push the wordmark off centre rather than balance it.
  backArrowMirror: { width: moderateScale(24) },
});

export const VerifyOtpScreen = () => {
  const { colors } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<AuthStackParamList>>();

  const pending = useAuthStore(s => s.pendingVerification);
  const verifyOtp = useAuthStore(s => s.verifyOtp);
  const resendOtp = useAuthStore(s => s.resendOtp);
  const cancelVerification = useAuthStore(s => s.cancelVerification);
  const isSubmitting = useAuthStore(s => s.isSubmitting);
  const serverError = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);

  const [code, setCode] = useState('');
  const otpField = useRef<OtpInputHandle>(null);

  /**
   * Puts the cursor back once React has re-enabled the field.
   *
   * The input is disabled for the duration of a request, and the same state
   * change that ends the request re-enables it. Focusing in the line straight
   * after `await` can land before React has flushed that render, and focusing
   * a still-disabled input does nothing on either platform — the user would be
   * left with a cleared field and no keyboard. One tick is enough.
   */
  const refocus = useCallback(() => {
    setTimeout(() => otpField.current?.focus(), 0);
  }, []);

  // Both clocks are re-seeded whenever the challenge object changes, which is
  // exactly what a successful resend produces — so the server, not the screen,
  // decides how long each one runs.
  const expiry = useCountdown(pending?.expiresInSeconds ?? null);
  const resend = useCountdown(pending?.resendInSeconds ?? null);

  const codeLength = pending?.codeLength ?? 6;
  const isExpired = expiry.isFinished;

  /**
   * Nothing to verify — the store was cleared, or the screen was reached
   * without a sign-up behind it. Leaving rather than rendering an empty shell.
   */
  useEffect(() => {
    if (!pending) {
      navigation.goBack();
    }
  }, [pending, navigation]);

  /**
   * Takes the code as an argument rather than reading state. `onComplete`
   * fires from inside the same change that completed the code, so `code` is
   * still one digit behind at that point — a handler that closed over it would
   * submit five digits, or nothing at all.
   *
   * A rejected code is cleared and the keyboard put back. Leaving the wrong
   * digits in place looks harmless and is not: the field is at its maximum
   * length, so every further keystroke is swallowed, and the input lost focus
   * while it was disabled for the request. The user is left looking at six
   * wrong digits that cannot be typed over.
   */
  const verify = useCallback(
    async (value: string) => {
      if (value.length !== codeLength || isExpired) {
        return;
      }

      const accepted = await verifyOtp(value);
      if (!accepted) {
        setCode('');
        refocus();
      }
    },
    [codeLength, isExpired, refocus, verifyOtp],
  );

  const submit = useCallback(() => verify(code), [code, verify]);

  const onChangeCode = useCallback(
    (next: string) => {
      // A wrong code leaves its error on screen; the moment the user edits it
      // the message is stale, so it goes as soon as they start fixing it.
      if (serverError) {
        clearError();
      }
      setCode(next);
    },
    [clearError, serverError],
  );

  const onResend = useCallback(async () => {
    setCode('');
    await resendOtp();
    // The old code is dead either way, so the field is ready for the new one.
    refocus();
  }, [refocus, resendOtp]);

  const goBack = useCallback(() => {
    cancelVerification();
    navigation.goBack();
  }, [cancelVerification, navigation]);

  if (!pending) {
    return null;
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <VStack gap="lg" pt="sm" pb="xxl">
          <HStack align="center">
            <Pressable
              onPress={goBack}
              feedback="opacity"
              visualSize={24}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Icon as={ChevronLeft} size="lg" />
            </Pressable>

            <VStack flex={1} align="center" gap="xs">
              <Wordmark size="lg" />
              <AppText
                variant="label"
                color="textSecondary"
                style={styles.tagline}
              >
                Move • Earn • Achieve
              </AppText>
            </VStack>

            {/* Balances the back arrow so the wordmark sits truly centred. */}
            <Box style={styles.backArrowMirror} />
          </HStack>

          <Center>
            <VerificationHeroArt />
          </Center>

          <VStack align="center" gap="xs">
            <AppText variant="h1" center>
              Verify Your Number
            </AppText>
            <AppText variant="body" color="textSecondary" center>
              {`Enter the ${codeLength}-digit OTP sent to`}
            </AppText>
            <HStack align="center" gap="sm" wrap justify="center">
              <AppText
                variant="bodyStrong"
                style={{ color: colors.brandAccent }}
              >
                {formatPhoneNumber(pending.phone)}
              </AppText>
              <Pressable
                onPress={goBack}
                feedback="opacity"
                accessibilityRole="button"
                accessibilityLabel="Change phone number"
              >
                <AppText
                  variant="bodyStrong"
                  style={{ color: colors.brandAccent }}
                >
                  Change
                </AppText>
              </Pressable>
            </HStack>
          </VStack>

          {serverError ? (
            <Alert
              tone="error"
              title="That code did not work"
              message={serverError.message}
              onDismiss={clearError}
            />
          ) : null}

          <OtpInput
            ref={otpField}
            value={code}
            onChange={onChangeCode}
            length={codeLength}
            onComplete={verify}
            disabled={isSubmitting || isExpired}
            autoFocus
            accessibilityLabel="One-time code"
          />

          <OtpSafetyNote />

          <HStack align="center" justify="center" gap="xs">
            <AppText variant="body" color="textSecondary">
              {isExpired ? 'This OTP has expired.' : 'OTP expires in'}
            </AppText>
            {isExpired ? null : (
              <AppText
                variant="bodyStrong"
                style={{ color: colors.brandAccent }}
              >
                {formatCountdown(expiry.secondsLeft)}
              </AppText>
            )}
          </HStack>

          <Button
            label="Verify & Continue"
            variant="brand"
            size="lg"
            fullWidth
            loading={isSubmitting}
            disabled={isSubmitting || isExpired || code.length < codeLength}
            onPress={submit}
          />

          <HStack align="center" gap="md">
            <Box flex={1}>
              <Divider />
            </Box>
            <AppText variant="label" color="textTertiary">
              or
            </AppText>
            <Box flex={1}>
              <Divider />
            </Box>
          </HStack>

          <ResendOtpRow
            onResend={onResend}
            secondsUntilAvailable={resend.secondsLeft}
            isSending={isSubmitting}
          />
        </VStack>
      </KeyboardAwareScrollView>
    </Screen>
  );
};
