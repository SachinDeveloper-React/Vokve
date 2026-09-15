import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AtSign, ChevronLeft, KeyRound } from 'lucide-react-native';
import { AppText } from '../../components/ui/AppText';
import { Button, FormInput, Pressable } from '../../components/form';
import { Alert, InfoNote } from '../../components/feedback';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { Icon } from '../../components/media/Icon';
import { Wordmark } from '../../components/brand/Wordmark';
import { HStack, VStack } from '../../components/layout/Stack';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { describeAuthError } from '../../utils/authErrors';
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from '../../types/forms';
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
 * Step one of a reset: which account. The same email-or-phone field as
 * sign-in, because a user who has forgotten a password is not going to
 * remember which of the two they registered with either.
 *
 * The server always answers with a challenge — a decoy for an unknown
 * identifier — so this screen never learns, and never says, whether the
 * account exists. It simply moves on to the code.
 */
export const ForgotPasswordScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation =
    useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const forgotPassword = useAuthStore(s => s.forgotPassword);
  const isSubmitting = useAuthStore(s => s.isSubmitting);
  const serverError = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);

  const { control, handleSubmit } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { identifier: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const onSubmit = useCallback(
    async (values: ForgotPasswordValues) => {
      clearError();
      const started = await forgotPassword(values.identifier);
      if (started) {
        navigation.navigate('ResetPassword');
      }
    },
    [clearError, forgotPassword, navigation],
  );

  const submit = useCallback(() => {
    handleSubmit(onSubmit)();
  }, [handleSubmit, onSubmit]);

  const goBack = useCallback(() => {
    clearError();
    navigation.goBack();
  }, [clearError, navigation]);

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
          <AppText variant="h1">Forgot your password?</AppText>
          <AppText variant="body" color="textSecondary">
            Enter the email or phone number on your account and we will send
            you a code to set a new one.
          </AppText>
        </View>

        {serverError ? (
          <Alert
            tone="error"
            title={describeAuthError(serverError, 'Could not start the reset').title}
            message={describeAuthError(serverError, 'Could not start the reset').message}
            onDismiss={clearError}
          />
        ) : null}

        <Card radius="xl" padding="lg" style={styles.card}>
          <FormInput
            control={control}
            name="identifier"
            placeholder="Email or Phone Number"
            accessibilityLabel="Email or phone number"
            containerStyle={styles.field}
            leading={<Icon as={AtSign} size="md" color="textTertiary" />}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          <Button
            label="Send Code"
            variant="brand"
            size="lg"
            fullWidth
            loading={isSubmitting}
            disabled={isSubmitting}
            onPress={submit}
          />
        </Card>

        <InfoNote
          icon={KeyRound}
          title="One code, one new password"
          message="The code is valid for a few minutes. Once it is confirmed, you will choose a new password and every other device will be signed out."
        />
      </KeyboardAwareScrollView>
    </Screen>
  );
};
