import React, { useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  Check,
  Ruler,
  ShieldCheck,
  User as UserIcon,
  Weight,
} from 'lucide-react-native';
import {
  Alert,
  AppText,
  Button,
  Center,
  FormFeetInchesField,
  FormInput,
  FormMeasureField,
  HStack,
  Icon,
  InfoNote,
  ProfileHeroBadge,
  Screen,
  VStack,
  Wordmark,
} from '../../components';
import { useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { describeAuthError } from '../../utils/authErrors';
import type { UnitSystem } from '../../types/models';
import {
  completeProfileSchema,
  convertMeasure,
  isProfileWithinRange,
  toCompleteProfilePayload,
  type CompleteProfileValues,
} from '../../types/forms';

/**
 * Which unit each figure reads in, per system.
 *
 * Imperial height says `ft/in` rather than `in` because that is what the field
 * actually holds once it is switched: a picker of feet and inches, not a box
 * expecting 69.
 */
const UNITS: Record<UnitSystem, { height: string; weight: string }> = {
  metric: { height: 'cm', weight: 'kg' },
  imperial: { height: 'ft/in', weight: 'lb' },
};

/**
 * The two rules the layout primitives cannot express: `letterSpacing`, which
 * has no token behind it, and the scroll view's growth, which takes a style
 * object rather than a component.
 */
const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  tagline: { letterSpacing: 2.4 },
});

export const CompleteProfileScreen = () => {
  const { colors } = useTheme();

  const completeProfile = useAuthStore(s => s.completeProfile);
  const isSubmitting = useAuthStore(s => s.isSubmitting);
  const serverError = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);

  const { control, handleSubmit, setValue, setError, getValues } =
    useForm<CompleteProfileValues>({
      resolver: zodResolver(completeProfileSchema),
      defaultValues: {
        name: '',
        units: 'metric',
        height: null,
        weight: null,
      },
      mode: 'onBlur',
      reValidateMode: 'onChange',
    });

  const units = useWatch({ control, name: 'units' });
  const name = useWatch({ control, name: 'name' });

  const unitLabels = UNITS[units ?? 'metric'];

  /** Mirrors the schema's own rule, so the tick and the error never disagree. */
  const isNameValid = useMemo(
    () => completeProfileSchema.shape.name.safeParse(name ?? '').success,
    [name],
  );

  /**
   * Switching system converts what is already typed rather than clearing it.
   * Someone who enters 175 and then realises they wanted inches means 69, not
   * a blank field — and re-typing is exactly the friction this screen exists
   * to avoid.
   */
  const toggleUnits = useCallback(() => {
    const next: UnitSystem = units === 'metric' ? 'imperial' : 'metric';
    const { height, weight } = getValues();

    setValue('units', next);
    if (height) {
      // Rounded to a whole inch going imperial: the picker offers whole
      // inches, and a stored 68.9 would have nothing to select.
      const converted = convertMeasure(height, 'height', next);
      setValue(
        'height',
        next === 'imperial' ? Math.round(converted) : converted,
      );
    }
    if (weight) {
      setValue('weight', convertMeasure(weight, 'weight', next));
    }
  }, [getValues, setValue, units]);

  const onSubmit = useCallback(
    async (values: CompleteProfileValues) => {
      clearError();
      const payload = toCompleteProfilePayload(values);

      // Range is checked here rather than in the schema because the bounds
      // only mean anything once both figures are in canonical units — 175 is
      // a sane height in centimetres and an impossible one in inches.
      if (!isProfileWithinRange(payload)) {
        setError('height', {
          message: 'Check your height and weight — those look off.',
        });
        return;
      }

      await completeProfile(payload);
    },
    [clearError, completeProfile, setError],
  );

  const submit = useCallback(() => {
    handleSubmit(onSubmit)();
  }, [handleSubmit, onSubmit]);

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <VStack gap="lg" pt="sm" pb="xxl">
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

          <Center>
            <ProfileHeroBadge />
          </Center>

          <VStack align="center" gap="xs">
            <AppText variant="h1" center>
              Complete Your Profile
            </AppText>
            <AppText variant="body" color="textSecondary" center>
              Tell us a bit about yourself to personalize your experience
            </AppText>
          </VStack>

          {serverError ? (
            <Alert
              tone="error"
              title={describeAuthError(serverError, 'Could not save your profile').title}
              message={describeAuthError(serverError, 'Could not save your profile').message}
              onDismiss={clearError}
            />
          ) : null}

          <VStack gap="base">
            <FormInput
              control={control}
              name="name"
              label="Full Name"
              placeholder="Your full name"
              helper="This will be shown on your profile"
              leading={<Icon as={UserIcon} size="md" color="textTertiary" />}
              trailing={
                isNameValid ? (
                  <Icon as={Check} size="md" tint={colors.success} />
                ) : null
              }
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
            />

            <HStack gap="base" align="start">
              <VStack flex={1}>
                {/*
                  Imperial height is picked, not typed. The value is the same
                  single number either way — only the way it is entered
                  changes, because nobody knows their height as 69 inches.
                */}
                {units === 'imperial' ? (
                  <FormFeetInchesField
                    control={control}
                    name="height"
                    label="Height"
                    sheetTitle="Select your height"
                    unit={unitLabels.height}
                    onUnitPress={toggleUnits}
                    leading={<Icon as={Ruler} size="md" color="textTertiary" />}
                  />
                ) : (
                  <FormMeasureField
                    control={control}
                    name="height"
                    label="Height"
                    placeholder="175"
                    unit={unitLabels.height}
                    onUnitPress={toggleUnits}
                    leading={<Icon as={Ruler} size="md" color="textTertiary" />}
                  />
                )}
              </VStack>
              <VStack flex={1}>
                <FormMeasureField
                  control={control}
                  name="weight"
                  label="Weight"
                  placeholder="68"
                  unit={unitLabels.weight}
                  onUnitPress={toggleUnits}
                  leading={<Icon as={Weight} size="md" color="textTertiary" />}
                />
              </VStack>
            </HStack>
          </VStack>

          <InfoNote
            icon={ShieldCheck}
            title="Your data is safe with us"
            message="We use your details to personalize your experience and track your progress better."
          />

          <Button
            label="Continue"
            variant="brand"
            size="lg"
            fullWidth
            loading={isSubmitting}
            disabled={isSubmitting}
            onPress={submit}
            icon={
              <Icon as={ArrowRight} size="md" tint={colors.primaryForeground} />
            }
            iconPosition="trailing"
          />

          <AppText variant="caption" color="textTertiary" center>
            You can change these details anytime from Settings
          </AppText>
        </VStack>
      </KeyboardAwareScrollView>
    </Screen>
  );
};
