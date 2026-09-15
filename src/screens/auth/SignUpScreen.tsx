import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Mars,
  Phone,
  Transgender,
  Venus,
} from 'lucide-react-native';
import {
  Alert,
  AppText,
  Box,
  Button,
  Divider,
  EMPTY_PHONE,
  FormCheckbox,
  FormDateField,
  FormInput,
  FormPhoneInput,
  FormSegmentedControl,
  HStack,
  Icon,
  Pressable,
  Screen,
  SocialAuthRow,
  VStack,
  Wordmark,
  type Segment,
  type SocialProvider,
} from '../../components';
import { useTheme } from '../../theme';
import { DEFAULT_COUNTRY_CODE } from '../../constants/countries';
import { useAuthStore } from '../../stores/authStore';
import { describeAuthError } from '../../utils/authErrors';
import type { Gender } from '../../types/models';
import {
  signUpSchema,
  toSignUpPayload,
  type SignUpValues,
} from '../../types/forms';
import type { AuthStackParamList } from '../../types/navigation';

const PROVIDER_NAMES: Record<SocialProvider, string> = {
  google: 'Google',
  apple: 'Apple',
  facebook: 'Facebook',
};

/**
 * The only two rules the layout primitives cannot express.
 *
 * `contentContainerStyle` takes a style object rather than a component, so the
 * scroll view's growth rule has nowhere else to live; and `letterSpacing` has
 * no token behind it, the tagline being the one place in the app that tracks
 * its letters out.
 */
const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  tagline: { letterSpacing: 2.4 },
});

export const SignUpScreen = () => {
  const { colors } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<AuthStackParamList>>();

  const signUp = useAuthStore(s => s.signUp);
  const isSubmitting = useAuthStore(s => s.isSubmitting);
  const serverError = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);

  /**
   * Each option carries its own tint so the three read as three answers
   * rather than as a scale, and the icons let the row be scanned without
   * reading it. Built here rather than at module scope because the tints are
   * theme colours, which only exist once a theme is in context.
   */
  const genders = useMemo<Segment<Gender>[]>(
    () => [
      { value: 'male', label: 'Male', icon: Mars, tint: colors.avatarPrimary },
      {
        value: 'female',
        label: 'Female',
        icon: Venus,
        tint: colors.avatarPink,
      },
      {
        value: 'other',
        label: 'Other',
        icon: Transgender,
        tint: colors.avatarPurple,
      },
    ],
    [colors],
  );

  const [isPasswordVisible, setPasswordVisible] = useState(false);
  const [isConfirmVisible, setConfirmVisible] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { control, handleSubmit, setError } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      email: 'sachin@snva.com',
      phone: { ...EMPTY_PHONE, country: DEFAULT_COUNTRY_CODE },
      password: 'Sachu_@#8700',
      confirmPassword: 'Sachu_@#8700',
      dateOfBirth: '',
      gender: null,
      acceptedTerms: false,
    },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const onSubmit = useCallback(
    async (values: SignUpValues) => {
      clearError();
      setNotice(null);

      // Sign-up does not sign anyone in — it returns a code sent to the number
      // on the form, so the next screen is the one that asks for it. On
      // failure the store's error is already on screen, and staying put is
      // what lets the user fix the field it names.
      if (await signUp(toSignUpPayload(values))) {
        navigation.navigate('VerifyOtp');
        return;
      }
      // A 422 names the fields it refused — "that email is already
      // registered" — and the server uses the same paths the form does, so
      // the message lands under the field rather than in a banner the user
      // has to map back themselves.
      const failure = useAuthStore.getState().error;
      for (const [field, message] of Object.entries(failure?.fieldErrors ?? {})) {
        setError(field as keyof SignUpValues | 'phone.number', { message });
      }
    },
    [clearError, navigation, setError, signUp],
  );

  const submit = useCallback(() => {
    handleSubmit(onSubmit)();
  }, [handleSubmit, onSubmit]);

  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const togglePassword = useCallback(
    () => setPasswordVisible(visible => !visible),
    [],
  );
  const toggleConfirm = useCallback(
    () => setConfirmVisible(visible => !visible),
    [],
  );

  const onSocialSelect = useCallback((provider: SocialProvider) => {
    setNotice(`${PROVIDER_NAMES[provider]} sign-up is not connected yet.`);
  }, []);

  const showTerms = useCallback(() => {
    setNotice('The full terms open on vokve.com for now.');
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <VStack gap="lg" pt="sm" pb="xxl">
          <HStack>
            <Pressable
              onPress={goBack}
              feedback="opacity"
              visualSize={24}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Icon as={ArrowLeft} size="lg" />
            </Pressable>
          </HStack>

          <VStack align="center" gap="xs">
            <Wordmark size="lg" />
            <AppText
              variant="label"
              color="textSecondary"
              style={styles.tagline}
            >
              Move • Earn • Achieve
            </AppText>
          </VStack>

          <VStack align="center" gap="xs">
            <AppText variant="h1" center>
              Create Your Account
            </AppText>
            <AppText variant="body" color="textSecondary" center>
              Join VOKVE and start your fitness journey
            </AppText>
          </VStack>

          {serverError ? (
            <Alert
              tone="error"
              title={describeAuthError(serverError, 'Could not create your account').title}
              message={describeAuthError(serverError, 'Could not create your account').message}
              onDismiss={clearError}
            />
          ) : null}

          {notice ? (
            <Alert tone="info" title={notice} onDismiss={dismissNotice} />
          ) : null}

          <VStack gap="base">
            <FormInput
              control={control}
              name="email"
              placeholder="Email Address"
              accessibilityLabel="Email address"
              leading={<Icon as={Mail} size="md" color="textTertiary" />}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
            />

            <FormPhoneInput
              control={control}
              name="phone"
              placeholder="Phone Number"
              leading={<Icon as={Phone} size="md" color="textTertiary" />}
              autoComplete="tel"
              textContentType="telephoneNumber"
              returnKeyType="next"
            />

            <FormInput
              control={control}
              name="password"
              placeholder="Password"
              accessibilityLabel="Password"
              helper="Password must be at least 8 characters with letters and numbers"
              leading={<Icon as={Lock} size="md" color="textTertiary" />}
              trailing={
                <Pressable
                  onPress={togglePassword}
                  feedback="opacity"
                  visualSize={24}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isPasswordVisible ? 'Hide password' : 'Show password'
                  }
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
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
            />

            <FormInput
              control={control}
              name="confirmPassword"
              placeholder="Confirm Password"
              accessibilityLabel="Confirm password"
              leading={<Icon as={Lock} size="md" color="textTertiary" />}
              trailing={
                <Pressable
                  onPress={toggleConfirm}
                  feedback="opacity"
                  visualSize={24}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isConfirmVisible
                      ? 'Hide confirmed password'
                      : 'Show confirmed password'
                  }
                >
                  <Icon
                    as={isConfirmVisible ? EyeOff : Eye}
                    size="md"
                    color="textTertiary"
                  />
                </Pressable>
              }
              secureTextEntry={!isConfirmVisible}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
            />

            <FormDateField
              control={control}
              name="dateOfBirth"
              label="Date of Birth"
              sheetTitle="Date of birth"
              leading={<Icon as={Calendar} size="md" color="textTertiary" />}
              trailing={
                <Icon as={ChevronDown} size="md" color="textTertiary" />
              }
            />

            <FormSegmentedControl
              control={control}
              name="gender"
              label="Gender"
              segments={genders}
            />

            <FormCheckbox
              control={control}
              name="acceptedTerms"
              tone="brand"
              label="I agree to the Terms and Conditions and Privacy Policy"
              labelSlot={
                <AppText variant="body">
                  I agree to the{' '}
                  <Text
                    style={{ color: colors.brandAccent }}
                    onPress={showTerms}
                    accessibilityRole="link"
                  >
                    Terms &amp; Conditions and Privacy Policy
                  </Text>
                </AppText>
              }
            />
          </VStack>

          <Button
            label="Create Account"
            variant="brand"
            size="lg"
            fullWidth
            loading={isSubmitting}
            disabled={isSubmitting}
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

          <SocialAuthRow onSelect={onSocialSelect} disabled={isSubmitting} />
        </VStack>
      </KeyboardAwareScrollView>
    </Screen>
  );
};
