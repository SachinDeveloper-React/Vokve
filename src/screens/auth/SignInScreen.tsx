import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ArrowRight,
  AtSign,
  Coins,
  Eye,
  EyeOff,
  Footprints,
  Gift,
  Lock,
  type LucideIcon,
} from 'lucide-react-native';
import { AppText } from '../../components/ui/AppText';
import { Button, FormInput, Pressable } from '../../components/form';
import { Alert } from '../../components/feedback';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { Icon } from '../../components/media/Icon';
import { Wordmark } from '../../components/brand/Wordmark';
import { AuthHeroBackdrop } from '../../components/auth/AuthHeroBackdrop';
import {
  SocialAuthRow,
  type SocialProvider,
} from '../../components/auth/SocialAuthRow';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { signInSchema, type SignInValues } from '../../types/forms';
import type { AuthStackParamList } from '../../types/navigation';
import { HStack } from '../../components';

/** The value strip along the bottom — why an account is worth having. */
const PERKS: { icon: LucideIcon; title: string; caption: string }[] = [
  { icon: Footprints, title: 'Track Steps', caption: 'Stay active daily' },
  { icon: Coins, title: 'Earn V-Coins', caption: 'Move & earn rewards' },
  { icon: Gift, title: 'Redeem Rewards', caption: 'Get exciting products' },
];

const PROVIDER_NAMES: Record<SocialProvider, string> = {
  google: 'Google',
  apple: 'Apple',
  facebook: 'Facebook',
};

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    content: {
      paddingTop: spacing.lg,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
    },

    hero: { gap: spacing.xs },
    heroArt: {
      position: 'absolute',
      top: -spacing.xxl,
      right: -spacing.base,
    },
    tagline: { letterSpacing: 2.4 },

    intro: { gap: spacing.xs },

    card: { gap: spacing.base },
    field: { minHeight: 56, borderRadius: radius.lg },
    forgot: { alignSelf: 'flex-end', marginBottom: spacing.sm },

    orRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    rule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },

    signUpRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },

    perks: { flexDirection: 'row', alignItems: 'stretch' },
    perk: {
      flex: 1,
      alignItems: 'center',
      gap: spacing.xxs,
      paddingHorizontal: spacing.xs,
    },
    perkDivider: {
      width: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    perkText: { textAlign: 'center' },
  });

export const SignInScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<AuthStackParamList>>();

  const signIn = useAuthStore(s => s.signIn);
  const isSubmitting = useAuthStore(s => s.isSubmitting);
  const serverError = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);

  const [isPasswordVisible, setPasswordVisible] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { identifier: '', password: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const onSubmit = useCallback(
    (values: SignInValues) => {
      clearError();
      setNotice(null);
      signIn(values.identifier.trim(), values.password);
    },
    [clearError, signIn],
  );

  const submit = useCallback(() => {
    handleSubmit(onSubmit)();
  }, [handleSubmit, onSubmit]);

  const togglePassword = useCallback(() => {
    setPasswordVisible(visible => !visible);
  }, []);

  const goToSignUp = useCallback(() => {
    navigation.navigate('SignUp');
  }, [navigation]);

  const onForgotPassword = useCallback(() => {
    setNotice('Password reset is not available in the app yet.');
  }, []);

  const onSocialSelect = useCallback((provider: SocialProvider) => {
    setNotice(`${PROVIDER_NAMES[provider]} sign-in is not connected yet.`);
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <View style={styles.hero}>
          <AuthHeroBackdrop style={styles.heroArt} />
          <Wordmark size="lg" />
          <AppText variant="label" color="textSecondary" style={styles.tagline}>
            Move • Earn • Achieve
          </AppText>
        </View>

        <View style={styles.intro}>
          <AppText variant="h1">Welcome back!</AppText>
          <AppText variant="body" color="textSecondary">
            Log in to continue your fitness journey
          </AppText>
        </View>

        {serverError ? (
          <Alert
            tone="error"
            title="Could not sign you in"
            message={serverError.message}
            onDismiss={clearError}
          />
        ) : null}

        {notice ? (
          <Alert tone="info" title={notice} onDismiss={dismissNotice} />
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
            returnKeyType="next"
          />

          <FormInput
            control={control}
            name="password"
            placeholder="Password"
            accessibilityLabel="Password"
            containerStyle={styles.field}
            leading={<Icon as={Lock} size="md" color="textTertiary" />}
            trailing={
              <Pressable
                onPress={togglePassword}
                accessibilityRole="button"
                accessibilityLabel={
                  isPasswordVisible ? 'Hide password' : 'Show password'
                }
                visualSize={24}
              >
                <Icon
                  as={isPasswordVisible ? EyeOff : Eye}
                  size="md"
                  color="textTertiary"
                />
              </Pressable>
            }
            secureTextEntry={!isPasswordVisible}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          <HStack justify="end" style={styles.forgot}>
            <Pressable
              onPress={onForgotPassword}
              accessibilityRole="button"
              accessibilityLabel="Forgot password"
              style={styles.forgot}
            >
              <AppText variant="caption" style={{ color: colors.brandAccent }}>
                Forgot Password?
              </AppText>
            </Pressable>
          </HStack>

          <Button
            label="Log In"
            variant="brand"
            size="lg"
            fullWidth
            loading={isSubmitting}
            disabled={isSubmitting}
            onPress={submit}
          />

          {formState.isSubmitted && !formState.isValid ? (
            <AppText variant="caption" color="destructive">
              Check the fields above and try again.
            </AppText>
          ) : null}

          <View style={styles.orRow}>
            <View style={styles.rule} />
            <AppText variant="label" color="textTertiary">
              or
            </AppText>
            <View style={styles.rule} />
          </View>

          <SocialAuthRow onSelect={onSocialSelect} disabled={isSubmitting} />

          <View style={styles.signUpRow}>
            <AppText variant="body" color="textSecondary">
              Don't have an account?
            </AppText>
            <Pressable
              onPress={goToSignUp}
              accessibilityRole="button"
              accessibilityLabel="Sign up"
            >
              <HStack align="center" gap="xs">
                <AppText
                  variant="bodyStrong"
                  style={{ color: colors.brandAccent }}
                >
                  Sign Up
                </AppText>
                <Icon as={ArrowRight} size="sm" tint={colors.brandAccent} />
              </HStack>
            </Pressable>
          </View>
        </Card>

        <Card radius="xl" padding="lg">
          <View style={styles.perks}>
            {PERKS.map((perk, index) => (
              <React.Fragment key={perk.title}>
                {index > 0 ? <View style={styles.perkDivider} /> : null}
                <View style={styles.perk}>
                  <Icon as={perk.icon} size="md" tint={colors.brandAccent} />
                  <AppText variant="micro" style={styles.perkText}>
                    {perk.title}
                  </AppText>
                  <AppText
                    variant="micro"
                    color="textTertiary"
                    style={styles.perkText}
                  >
                    {perk.caption}
                  </AppText>
                </View>
              </React.Fragment>
            ))}
          </View>
        </Card>
      </KeyboardAwareScrollView>
    </Screen>
  );
};
