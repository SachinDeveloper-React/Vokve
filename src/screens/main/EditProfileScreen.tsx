import React, { useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ruler, Weight } from 'lucide-react-native';
import { useToast } from '../../components/feedback/Toast';
import {
  FormDateField,
  FormInput,
  FormMeasureField,
  FormSegmentedControl,
  FormSelect,
} from '../../components/form/fields';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { HStack, VStack } from '../../components/layout/Stack';
import { AvatarPicker } from '../../components/account/AvatarPicker';
import { Icon } from '../../components/media/Icon';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { toApiError } from '../../services/api/errors';
import { useAccountStore } from '../../stores/accountStore';
import { useAuthStore, useCurrentUser } from '../../stores/authStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import {
  convertMeasure,
  editProfileSchema,
  toEditProfilePayload,
  type EditProfileValues,
} from '../../types/forms';
import type {
  ActivityLevel,
  FitnessGoal,
  Gender,
  UnitSystem,
} from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    grow: { flex: 1 },
  });

/** The goals as a member would describe them, not as the model spells them. */
const GOALS: { value: FitnessGoal; label: string }[] = [
  { value: 'lose_weight', label: 'Lose weight' },
  { value: 'build_muscle', label: 'Build muscle' },
  { value: 'gain_strength', label: 'Gain strength' },
  { value: 'improve_endurance', label: 'Improve endurance' },
  { value: 'stay_active', label: 'Stay active' },
];

const ACTIVITY_LEVELS: { value: ActivityLevel; label: string }[] = [
  { value: 'sedentary', label: 'Sedentary — desk job, little exercise' },
  { value: 'light', label: 'Light — a walk or two a week' },
  { value: 'moderate', label: 'Moderate — training 3–4 times a week' },
  { value: 'active', label: 'Active — training most days' },
  { value: 'athlete', label: 'Athlete — twice a day, most days' },
];

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
];

const WEEKLY_GOALS = [1, 2, 3, 4, 5, 6, 7].map(n => ({
  value: String(n) as `${number}`,
  label: `${n} ${n === 1 ? 'session' : 'sessions'} a week`,
}));

/**
 * The profile form (RULES P1, P2).
 *
 * Everything here is `PATCH /me`, which cannot stamp `profileCompletedAt` —
 * onboarding is the only thing that does, so a member editing their weight
 * can never be sent back through it. The height and weight are typed in
 * whichever system the member prefers and converted at the boundary, with
 * the range checked after conversion: the same figure is a sane height in
 * centimetres and an impossible one in inches.
 *
 * The whole form is one save rather than a field at a time. A profile is
 * read as a set — the goal and the activity level answer each other — and a
 * screen that wrote on every blur would have the member watching six
 * requests go by while they filled it in.
 */
export const EditProfileScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'EditProfile'>['route']>();
  const toast = useToast();
  const user = useCurrentUser();
  const balance = useCoinBalance();
  const updateProfile = useAuthStore(s => s.updateProfile);
  const isSubmitting = useAuthStore(s => s.isSubmitting);
  const hydrateProfile = useAccountStore(s => s.hydrateFromServer);
  const storedUnits = useSettingsStore(s => s.units);
  const setUnits = useSettingsStore(s => s.setUnits);

  const units: UnitSystem = user?.units ?? storedUnits;

  const defaultValues = useMemo<EditProfileValues>(
    () => ({
      name: user?.name ?? '',
      dateOfBirth: user?.dateOfBirth ?? null,
      gender: user?.gender ?? null,
      units,
      // Stored canonical (cm, kg); only imperial needs converting for display.
      height:
        user?.heightCm == null
          ? null
          : units === 'imperial'
          ? convertMeasure(user.heightCm, 'height', 'imperial')
          : user.heightCm,
      weight:
        user?.weightKg == null
          ? null
          : units === 'imperial'
          ? convertMeasure(user.weightKg, 'weight', 'imperial')
          : user.weightKg,
      goal: user?.goal ?? 'stay_active',
      activityLevel: user?.activityLevel ?? 'moderate',
      weeklyGoalWorkouts: user?.weeklyGoalWorkouts ?? 4,
    }),
    [units, user],
  );

  const { control, handleSubmit, setValue, getValues, setError, watch } =
    useForm<EditProfileValues>({
      resolver: zodResolver(editProfileSchema),
      defaultValues,
      mode: 'onBlur',
    });

  const currentUnits = watch('units');
  const unitLabels =
    currentUnits === 'imperial'
      ? { height: 'in', weight: 'lb' }
      : { height: 'cm', weight: 'kg' };

  /**
   * Switching the unit converts what is already typed rather than clearing
   * it: a member who typed 70 kg and then tapped "lb" meant to see 154, not
   * an empty field.
   */
  const toggleUnits = useCallback(() => {
    const next: UnitSystem =
      getValues('units') === 'imperial' ? 'metric' : 'imperial';
    const height = getValues('height');
    const weight = getValues('weight');
    setValue('units', next);
    if (height !== null) {
      setValue('height', convertMeasure(height, 'height', next));
    }
    if (weight !== null) {
      setValue('weight', convertMeasure(weight, 'weight', next));
    }
  }, [getValues, setValue]);

  /**
   * The photo saves on its own, so the completeness figure that counts it
   * has to be re-read — otherwise the account screen still asks for a photo
   * the member has just added.
   */
  const onAvatarChanged = useCallback(() => {
    hydrateProfile();
  }, [hydrateProfile]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Account' });
  }, [navigation]);

  const onSubmit = handleSubmit(async values => {
    const { payload, errors } = toEditProfilePayload(values);
    if (errors.height || errors.weight) {
      if (errors.height) setError('height', { message: errors.height });
      if (errors.weight) setError('weight', { message: errors.weight });
      return;
    }
    try {
      await updateProfile(payload);
      // The units the member chose here are the app's units everywhere else.
      setUnits(payload.units);
      // The level, the streak and the completeness all move with the profile.
      hydrateProfile();
      toast.show({ title: 'Profile saved', tone: 'success' });
      onPressBack();
    } catch (error) {
      const apiError = toApiError(error);
      for (const [field, message] of Object.entries(apiError.fieldErrors)) {
        if (field in values) {
          setError(field as keyof EditProfileValues, { message });
        }
      }
      toast.show({
        title: "Couldn't save your profile",
        message: apiError.message,
        tone: 'error',
      });
    }
  });

  return (
    <Screen edges={['top']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title="Edit profile"
          subtitle="Used for your goals, not shown to anyone else"
        />

        <Card radius="xl" padding="base">
          <HStack align="center" gap="md">
            <AvatarPicker
              name={user?.name ?? 'vokve'}
              uri={user?.avatarUrl}
              size="lg"
              onChange={onAvatarChanged}
            />
            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong">Profile photo</AppText>
              <AppText variant="micro" color="textTertiary">
                {user?.avatarUrl
                  ? 'Tap to change or remove it. Saved as soon as you choose.'
                  : 'Tap to add one. Until you do we draw your initials.'}
              </AppText>
            </VStack>
          </HStack>
        </Card>

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <AppText variant="label" color="textSecondary">
              About you
            </AppText>
            <FormInput
              control={control}
              name="name"
              label="Full name"
              placeholder="Asha Verma"
              autoCapitalize="words"
              autoFocus={route.params?.focus === 'name'}
            />
            <FormDateField
              control={control}
              name="dateOfBirth"
              label="Date of birth"
              helper="Used to tune calorie and heart-rate targets."
            />
            <FormSegmentedControl
              control={control}
              name="gender"
              label="Gender"
              segments={GENDERS}
            />
          </VStack>
        </Card>

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <HStack align="center" justify="between">
              <AppText variant="label" color="textSecondary">
                Measurements
              </AppText>
              <AppText variant="micro" color="textTertiary">
                {currentUnits === 'imperial' ? 'Imperial' : 'Metric'}
              </AppText>
            </HStack>
            <HStack gap="sm">
              <FormMeasureField
                control={control}
                name="height"
                label="Height"
                placeholder="175"
                unit={unitLabels.height}
                onUnitPress={toggleUnits}
                leading={<Icon as={Ruler} size="md" color="textTertiary" />}
                style={styles.grow}
              />
              <FormMeasureField
                control={control}
                name="weight"
                label="Weight"
                placeholder="70"
                unit={unitLabels.weight}
                onUnitPress={toggleUnits}
                leading={<Icon as={Weight} size="md" color="textTertiary" />}
                style={styles.grow}
              />
            </HStack>
          </VStack>
        </Card>

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <AppText variant="label" color="textSecondary">
              Training
            </AppText>
            <FormSelect
              control={control}
              name="goal"
              label="Goal"
              sheetTitle="What are you training for?"
              options={GOALS}
            />
            <FormSelect
              control={control}
              name="activityLevel"
              label="Activity level"
              sheetTitle="How active are you?"
              options={ACTIVITY_LEVELS}
            />
            <FormSelect
              control={control}
              name="weeklyGoalWorkouts"
              label="Weekly goal"
              sheetTitle="Sessions a week"
              options={WEEKLY_GOALS}
            />
          </VStack>
        </Card>

        <Button
          label="Save changes"
          variant="brand"
          fullWidth
          loading={isSubmitting}
          disabled={isSubmitting}
          onPress={() => onSubmit()}
        />
      </KeyboardAwareScrollView>
    </Screen>
  );
};
