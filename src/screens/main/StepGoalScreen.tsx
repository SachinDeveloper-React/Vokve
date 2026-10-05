import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { BrandSignOff } from '../../components/brand/BrandSignOff';
import { useToast } from '../../components/feedback/Toast';
import {
  GOAL_RANGE_FALLBACK,
  snapGoal,
  StepGoalAdviceCard,
  StepGoalBenefitsCard,
  StepGoalHeader,
  StepGoalHeroCard,
  StepGoalSlider,
  StepGoalStepper,
  StepGoalSummaryCard,
} from '../../components/goal';
import { VStack } from '../../components/layout/Stack';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { useStepGoal } from '../../hooks/useActivity';
import { toApiError } from '../../services/api/errors';
import { useDailyStepGoal, useSettingsStore } from '../../stores/settingsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { formatGrouped } from '../../utils/format';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxl, gap: spacing.base },
  });

interface Props {
  /**
   * The set-up after sign-in (D-55): the picker starts on the suggestion
   * rather than the goal the account was given, there is no chevron, and a
   * save that fails still lets the user into the app.
   */
  setup?: boolean;
  /** After the goal is saved. */
  onDone: () => void;
  onPressBack?: () => void;
}

/**
 * Choosing the daily step goal (D-55): the goal now and the one the server
 * suggests from the profile and the recent days, a picker kept to the
 * server's range and increment, and a save that waits for the server — the
 * goal is the account's, on every phone, so it is not "saved" until the
 * server has it.
 *
 * Shown on its own from the dashboard's "Edit Goal", and as the last screen
 * of the set-up after sign-in. The screen works before the server answers:
 * the goal comes from the settings already on the phone and the range from
 * the defaults, and the suggestion fills in when it lands — taking the
 * picker with it in the set-up, until the user moves it themselves.
 */
export const StepGoalView = ({ setup = false, onDone, onPressBack }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const toast = useToast();
  const current = useDailyStepGoal();
  const saveDailyStepGoal = useSettingsStore(s => s.saveDailyStepGoal);
  const { data, loading } = useStepGoal();
  const [picked, setPicked] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const range = data ?? GOAL_RANGE_FALLBACK;
  const start = setup ? data?.recommended ?? current : current;
  const value = snapGoal(picked ?? start, range);

  const takeRecommended = useCallback(() => {
    if (data) setPicked(data.recommended);
  }, [data]);

  const onSave = useCallback(async () => {
    setSaving(true);
    try {
      await saveDailyStepGoal(value);
      toast.show({
        title: 'Daily goal saved',
        message: `${formatGrouped(
          value,
        )} steps a day. Change it any time from Home.`,
        tone: 'success',
      });
      setSaving(false);
      onDone();
    } catch (error) {
      const failure = toApiError(error);
      const reason = failure.details?.dailyStepGoal;
      setSaving(false);
      toast.show({
        title: "Couldn't save your goal",
        message:
          typeof reason === 'string'
            ? reason
            : setup
            ? 'You can set it any time from Home.'
            : failure.message,
        tone: 'error',
      });
      // The way into the app never waits on the goal.
      if (setup) onDone();
    }
  }, [onDone, saveDailyStepGoal, setup, toast, value]);

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <StepGoalHeader onPressBack={setup ? undefined : onPressBack} />

        <StepGoalHeroCard />

        <StepGoalSummaryCard
          current={current}
          recommended={data?.recommended ?? null}
          loading={loading}
          onUseRecommended={takeRecommended}
        />

        {data ? (
          <StepGoalAdviceCard
            recommended={data.recommended}
            basedOn={data.basedOn}
          />
        ) : null}

        <VStack gap="xxs" pt="xs">
          <AppText variant="h3" accessibilityRole="header">
            Set Your Daily Goal
          </AppText>
          <AppText variant="caption" color="textSecondary">
            {`Choose a goal between ${formatGrouped(
              range.min,
            )} and ${formatGrouped(range.max)} steps.`}
          </AppText>
        </VStack>

        <StepGoalStepper value={value} range={range} onChange={setPicked} />

        <StepGoalSlider value={value} range={range} onChange={setPicked} />

        <StepGoalBenefitsCard />

        <Button
          label="Save Goal"
          variant="brand"
          size="lg"
          fullWidth
          loading={saving}
          disabled={saving}
          onPress={onSave}
        />

        <BrandSignOff />
      </ScrollView>
    </Screen>
  );
};

/** The goal screen from the dashboard: back where it came from once saved. */
export const StepGoalScreen = () => {
  const navigation = useNavigation();

  const close = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  return <StepGoalView onDone={close} onPressBack={close} />;
};
