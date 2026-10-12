import React, { Fragment, memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { Check, ChevronDown, ChevronUp } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { DietPlanDetail, DietPlanSummary } from '../../types/models';
import { formatGrouped, formatTimeOfDay } from '../../utils/format';
import {
  DIET_LABEL,
  MEAL_PLAN_LABEL,
  MEAL_STYLE,
} from '../nutrition/nutritionLabels';
import { Divider } from '../layout/Divider';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { LoadState } from '../ui/LoadState';
import { Tag } from '../ui/Tag';
import { Pressable } from '../form/Pressable';

const DISC = moderateScale(40);

interface DayProps {
  day: DietPlanDetail['days'][number];
}

/** One day of the plan, read rather than followed: its meals and what they come to. */
const PlanDay = memo(({ day }: DayProps) => (
  <VStack gap="xs" py="sm">
    <HStack align="center" gap="sm">
      <AppText variant="bodyStrong">
        {day.label.length > 0 ? day.label : `Day ${day.dayNumber}`}
      </AppText>
      <HStack flex={1} justify="end">
        <AppText variant="micro" color="textSecondary">
          {`${formatGrouped(day.totals.calories)} kcal`}
        </AppText>
      </HStack>
    </HStack>

    {day.meals.map(meal => (
      <HStack key={meal.id} align="center" gap="sm">
        <Emoji size="sm">{MEAL_STYLE[meal.slot].emoji}</Emoji>
        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
          {`${MEAL_STYLE[meal.slot].label} · ${formatTimeOfDay(meal.time)}`}
        </AppText>
        <HStack flex={1} justify="end">
          <AppText variant="micro" color="textSecondary">
            {`${formatGrouped(meal.calories)} kcal`}
          </AppText>
        </HStack>
      </HStack>
    ))}
  </VStack>
));

PlanDay.displayName = 'PlanDay';

interface Props {
  plan: DietPlanSummary;
  /** Open, with every day of it listed. */
  expanded: boolean;
  /** The days, once the server has sent them. Null while they are on their way. */
  detail: DietPlanDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  onToggle: (planId: string) => void;
  onRetryDetail: () => void;
  onChoose: (planId: string) => void;
}

/**
 * One plan in the library: what it is, who it is for, and what a day of it
 * comes to.
 *
 * The card opens in place rather than pushing a screen of its own. Choosing a
 * plan is a comparison — three days of this against two of that — and a
 * comparison made by pushing and popping screens is one the user has to hold
 * in their head instead of on the glass.
 *
 * The figures are per day rather than per plan: "1,250 kcal" is a number a
 * user already measures their own day against, where a plan's total over
 * three days is a number nothing else on the screen is in.
 */
export const DietPlanOptionCard = memo(
  ({
    plan,
    expanded,
    detail,
    detailLoading,
    detailError,
    onToggle,
    onRetryDetail,
    onChoose,
  }: Props) => {
    const { colors } = useTheme();
    const toggle = useCallback(() => onToggle(plan.id), [onToggle, plan.id]);
    const choose = useCallback(() => onChoose(plan.id), [onChoose, plan.id]);

    const dietWords = plan.dietTypes.map(type => DIET_LABEL[type]).join(' · ');
    const planWords = plan.mealPlans.map(type => MEAL_PLAN_LABEL[type]);

    return (
      <Card radius="xl" padding="base">
        <VStack gap="sm">
          <Pressable
            onPress={toggle}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityState={{ expanded, selected: plan.selected }}
            accessibilityLabel={`${plan.name}, ${plan.dayCount} days, ${formatGrouped(
              plan.perDay.calories,
            )} calories a day${plan.selected ? ', in use' : ''}`}
          >
            <HStack align="center" gap="md">
              <Box
                radius="pill"
                style={[styles.disc, { backgroundColor: colors.muted }]}
              >
                <Emoji size="sm">{plan.emoji}</Emoji>
              </Box>

              <VStack flex={1} gap="xxs">
                <HStack align="center" gap="sm">
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {plan.name}
                  </AppText>
                  {plan.selected ? (
                    <Tag label="In use" tint={colors.success} />
                  ) : null}
                </HStack>
                <AppText
                  variant="miniMicro"
                  color="textSecondary"
                  numberOfLines={1}
                >
                  {dietWords}
                </AppText>
              </VStack>

              <Icon
                as={expanded ? ChevronUp : ChevronDown}
                size="xs"
                color="textTertiary"
              />
            </HStack>
          </Pressable>

          {plan.description.length > 0 ? (
            <AppText variant="caption" color="textSecondary">
              {plan.description}
            </AppText>
          ) : null}

          <HStack gap="xs" wrap>
            <Chip label={`${plan.dayCount}-day rotation`} />
            <Chip
              label={`${formatGrouped(plan.perDay.calories)} kcal / day`}
              tint={colors.success}
            />
            <Chip
              label={`${plan.mealsPerDay} meals / day`}
              tint={colors.textSecondary}
            />
            {planWords.map(word => (
              <Chip key={word} label={word} tint={colors.warning} />
            ))}
          </HStack>

          {/* Said on the card rather than only in the ordering, so a user who
              scrolls past the first row still knows which plans were written
              for how they eat. */}
          {plan.suitsPreferences ? (
            <HStack align="center" gap="xs">
              <Icon as={Check} size="xs" color="success" />
              <AppText variant="micro" color="success">
                Matches your diet type and meal plan
              </AppText>
            </HStack>
          ) : null}

          {expanded ? (
            <VStack gap="none">
              <Divider />
              {detail !== null ? (
                <>
                  {detail.days.map((day, index) => (
                    <Fragment key={day.dayNumber}>
                      {index > 0 ? <Divider /> : null}
                      <PlanDay day={day} />
                    </Fragment>
                  ))}
                  <Box pt="sm">
                    <Button
                      label={plan.selected ? 'This is your plan' : 'Use this plan'}
                      variant={plan.selected ? 'secondary' : 'primary'}
                      size="md"
                      fullWidth
                      disabled={plan.selected}
                      onPress={choose}
                    />
                  </Box>
                </>
              ) : (
                <Box pt="sm">
                  <LoadState
                    loading={detailLoading}
                    title="Couldn't load the plan's days"
                    message={detailError}
                    onRetry={onRetryDetail}
                  />
                </Box>
              )}
            </VStack>
          ) : null}
        </VStack>
      </Card>
    );
  },
);

DietPlanOptionCard.displayName = 'DietPlanOptionCard';

const styles = StyleSheet.create({
  disc: {
    width: DISC,
    height: DISC,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
