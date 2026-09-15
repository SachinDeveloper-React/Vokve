import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft, Eye, EyeOff, Lock } from 'lucide-react-native';
import { AppText } from '../../components/ui/AppText';
import { Button, FormInput, OtpInput, Pressable, type OtpInputHandle } from '../../components/form';
import { Alert } from '../../components/feedback';
import { ResendOtpRow } from '../../components/auth/ResendOtpRow';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { Icon } from '../../components/media/Icon';
import { Wordmark } from '../../components/brand/Wordmark';
import { HStack, VStack } from '../../components/layout/Stack';
import { useCountdown } from '../../hooks';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { useAuthStore, usePendingReset } from '../../stores/authStore';
import { resetPasswordSchema, type ResetPasswordValues } from '../../types/forms';
import { formatCountdown, formatPhoneNumber } from '../../utils/format';
import { describeOtpError } from '../../utils/authErrors';
import { DevCodeHint } from '../../components/auth/DevCodeHint';
import type { AuthStackParamList } from '../../types/navigation';

const makeStyles = ({ spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    content: {
      paddingTop: spacing.sm,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
    },
    tagline: { letterSpacing: 2.4 },
    intro: { gap: spacing.xs },
    card: { gap: spacing.base },
    field: { minHeight: 56, borderRadius: radius.lg },
    backMirror: { width: 24 },
  });

/**
 * Step two of a reset: the code and the new password, together.
 *
 * One screen rather than code-then-password: the server checks both in a
 * single call, so splitting them would mean either verifying the code twice
 * or holding a "code was right" flag on the client that the server never
 * issued. The countdowns come from the challenge the server returned, as
 * they do on the sign-up OTP screen.
 */
export const ResetPasswordScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const pending = usePendingReset();
  const resetPassword = useAuthStore(s => s.resetPassword);
  const resendResetOtp = useAuthStore(s => s.resendResetOtp);
  const cancelReset = useAuthStore(s => s.cancelReset);
  const isSubmitting = useAuthStore(s => s.isSubmitting);
  const serverError = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);

  const [code, setCode] = useState('');
  const [isPasswordVisible, setPasswordVisible] = useState(false);
  const otpField = useRef<OtpInputHandle>(null);

  const expiry = useCountdown(pending?.expiresInSeconds ?? null);
  const resend = useCountdown(pending?.resendInSeconds ?? null);
  const codeLength = pending?.codeLength ?? 6;
  const isExpired = expiry.isFinished;
  const isEmail = pending?.channel === 'email';

  const { control, handleSubmit } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // Arriving without a challenge — a reload, or a cancelled reset — has
  // nothing to verify against, so the screen sends the user back.
  useEffect(() => {
    if (!pending) {
      navigation.goBack();
    }
  }, [pending, navigation]);

  const onSubmit = useCallback(
    async (values: ResetPasswordValues) => {
      if (code.length !== codeLength || isExpired) {
        return;
      }
      clearError();
      const done = await resetPassword(code, values.password);
      if (done) {
        navigation.navigate('SignIn', {
          notice: 'Your password has been updated. Sign in with the new one.',
        });
      } else {
        setCode('');
        setTimeout(() => otpField.current?.focus(), 0);
      }
    },
    [clearError, code, codeLength, isExpired, navigation, resetPassword],
  );

  const submit = useCallback(() => {
    handleSubmit(onSubmit)();
  }, [handleSubmit, onSubmit]);

  const onChangeCode = useCallback(
    (next: string) => {
      if (serverError) {
        clearError();
      }
      setCode(next);
    },
    [clearError, serverError],
  );

  const onResend = useCallback(async () => {
    setCode('');
    const sent = await resendResetOtp();
    const fresh = useAuthStore.getState().pendingReset;
    if (sent && fresh) {
      expiry.restart(fresh.expiresInSeconds);
      resend.restart(fresh.resendInSeconds);
    }
    setTimeout(() => otpField.current?.focus(), 0);
  }, [expiry, resend, resendResetOtp]);

  const goBack = useCallback(() => {
    cancelReset();
    navigation.goBack();
  }, [cancelReset, navigation]);

  const togglePassword = useCallback(() => {
    setPasswordVisible(visible => !visible);
  }, []);

  if (!pending) {
    return null;
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
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
            <AppText variant="label" color="textSecondary" style={styles.tagline}>
              Move • Earn • Achieve
            </AppText>
          </VStack>
          <View style={styles.backMirror} />
        </HStack>

        <View style={styles.intro}>
          <AppText variant="h1">Set a new password</AppText>
          <AppText variant="body" color="textSecondary">
            {`Enter the ${codeLength}-digit code sent to`}
          </AppText>
          <AppText variant="bodyStrong" style={{ color: colors.brandAccent }}>
            {isEmail ? pending.target : formatPhoneNumber(pending.phone)}
          </AppText>
        </View>

        {serverError ? (
          <Alert
            tone="error"
            title={describeOtpError(serverError).title}
            message={describeOtpError(serverError).message}
            onDismiss={clearError}
          />
        ) : null}

        <Card radius="xl" padding="lg" style={styles.card}>
          <OtpInput
            ref={otpField}
            value={code}
            onChange={onChangeCode}
            length={codeLength}
            disabled={isSubmitting || isExpired}
            autoFocus
            accessibilityLabel="Reset code"
          />
          <DevCodeHint code={pending.devCode} onUse={onChangeCode} />
          <HStack align="center" justify="center" gap="xs">
            <AppText variant="body" color="textSecondary">
              {isExpired ? 'This code has expired.' : 'Code expires in'}
            </AppText>
            {isExpired ? null : (
              <AppText variant="bodyStrong" style={{ color: colors.brandAccent }}>
                {formatCountdown(expiry.secondsLeft)}
              </AppText>
            )}
          </HStack>

          <FormInput
            control={control}
            name="password"
            label="New password"
            placeholder="At least 8 characters"
            accessibilityLabel="New password"
            containerStyle={styles.field}
            leading={<Icon as={Lock} size="md" color="textTertiary" />}
            trailing={
              <Pressable
                onPress={togglePassword}
                accessibilityRole="button"
                accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
                visualSize={24}
              >
                <Icon as={isPasswordVisible ? EyeOff : Eye} size="md" color="textTertiary" />
              </Pressable>
            }
            secureTextEntry={!isPasswordVisible}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
          />
          <FormInput
            control={control}
            name="confirmPassword"
            label="Confirm new password"
            placeholder="Type it again"
            accessibilityLabel="Confirm new password"
            containerStyle={styles.field}
            leading={<Icon as={Lock} size="md" color="textTertiary" />}
            secureTextEntry={!isPasswordVisible}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          <Button
            label="Update Password"
            variant="brand"
            size="lg"
            fullWidth
            loading={isSubmitting}
            disabled={isSubmitting || isExpired || code.length < codeLength}
            onPress={submit}
          />

          <ResendOtpRow
            onResend={onResend}
            secondsUntilAvailable={resend.secondsLeft}
            isSending={isSubmitting}
          />
        </Card>
      </KeyboardAwareScrollView>
    </Screen>
  );
};
