import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { DietPlanHeader } from '../../components/diet/DietPlanHeader';
import { DietPlanOptionCard } from '../../components/diet/DietPlanOptionCard';
import { useToast } from '../../components/feedback/Toast';
import { VStack } from '../../components/layout/Stack';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useDietPlanDetail, useDietPlans } from '../../hooks/useNutrition';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useNutritionStore } from '../../stores/nutritionStore';
import { useThemedStyles, type ThemeShape } from '../../theme';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * The diet plan library: the plans an operator has written, and which of them
 * this user follows (RULES N10).
 *
 * The plans are the server's (`GET /diet-plans`), and so is the choice — it is
 * a field of the nutrition profile, so it follows the account onto the user's
 * next phone rather than living in this install.
 *
 * Every plan is listed, not only the ones that suit the user's preferences.
 * The ones written for how they eat come first and say so, but somebody who
 * keeps two days of the week vegetarian is entitled to read the plan for it,
 * and a library that hid it would be answering a question about their diet
 * type that they did not ask.
 *
 * "Let the app choose" is offered only once a plan has been picked, because
 * before that it is already what is happening and an option that changes
 * nothing is a control that teaches the user their taps do not matter.
 */
export const DietPlansScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const toast = useToast();

  const plans = useDietPlans();
  const setSelectedPlan = useNutritionStore(s => s.setSelectedPlan);
  const refreshIfStale = useNutritionStore(s => s.refreshIfStale);
  useRefreshOnFocus(refreshIfStale);

  /** The one card open, or null while all are shut. One at a time: two open cards is a list nobody can compare. */
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const detail = useDietPlanDetail(openPlanId);

  const toggle = useCallback(
    (planId: string) =>
      setOpenPlanId(current => (current === planId ? null : planId)),
    [],
  );

  const choose = useCallback(
    (planId: string) => {
      const plan = plans.data?.find(candidate => candidate.id === planId);
      setSelectedPlan(planId);
      toast.show({
        title: 'Plan chosen',
        message: plan
          ? `${plan.name} starts from today.`
          : 'Your plan starts from today.',
        tone: 'success',
      });
      navigation.goBack();
    },
    [navigation, plans.data, setSelectedPlan, toast],
  );

  const handOver = useCallback(() => {
    setSelectedPlan(null);
    toast.show({
      title: 'Back to automatic',
      message: 'VOKVE will pick a plan from your preferences.',
      tone: 'info',
    });
    navigation.goBack();
  }, [navigation, setSelectedPlan, toast]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('DietPlan');
  }, [navigation]);

  const hasChoice = useMemo(
    () => plans.data?.some(plan => plan.selected) ?? false,
    [plans.data],
  );

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <DietPlanHeader
          onPressBack={onPressBack}
          title="Diet Plans"
          subtitle="Pick the plan you want to eat by."
        />

        {plans.data === null ? (
          <LoadState
            loading={plans.loading}
            title="Couldn't load the plans"
            message={plans.error}
            onRetry={plans.reload}
          />
        ) : plans.data.length === 0 ? (
          <EmptyState
            title="No plans yet"
            message="There are no diet plans on offer right now. Your day still follows your own targets."
          />
        ) : (
          <>
            {plans.data.map(plan => (
              <DietPlanOptionCard
                key={plan.id}
                plan={plan}
                expanded={plan.id === openPlanId}
                detail={plan.id === openPlanId ? detail.data : null}
                detailLoading={detail.loading}
                detailError={detail.error}
                onToggle={toggle}
                onRetryDetail={detail.reload}
                onChoose={choose}
              />
            ))}

            {hasChoice ? (
              <VStack gap="xs">
                <Button
                  label="Let VOKVE choose for me"
                  variant="ghost"
                  size="md"
                  fullWidth
                  onPress={handOver}
                />
                <AppText variant="micro" color="textSecondary" center>
                  Your diet type and meal plan will decide, as they did before.
                </AppText>
              </VStack>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
};
