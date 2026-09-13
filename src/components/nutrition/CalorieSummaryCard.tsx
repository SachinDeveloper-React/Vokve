import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { formatGrouped } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { ProgressRing } from '../fitness/ProgressRing';
import { Pressable } from '../form/Pressable';
import { MacroBar } from './MacroBar';

interface LegendProps {
  label: string;
  value: string;
  tint: string;
  foreground: string;
  secondary: string;
}

const LegendRow = memo(
  ({ label, value, tint, foreground, secondary }: LegendProps) => (
    <HStack
      align="center"
      gap="sm"
      accessible
      accessibilityLabel={`${label}, ${value}`}
    >
      <View style={[styles.dot, { backgroundColor: tint }]} />

      <VStack gap="none">
        <AppText variant="miniMicro" style={{ color: secondary }}>
          {label}
        </AppText>
        <AppText variant="bodyStrong" numberOfLines={1} style={{ color: foreground }}>
          {value}
        </AppText>
      </VStack>
    </HStack>
  ),
);

LegendRow.displayName = 'LegendRow';

interface Props {
  consumed: number;
  goal: number;
  burned: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
  proteinGoalG: number;
  carbsGoalG: number;
  fatsGoalG: number;
  onPressLearnMore: () => void;
}

/**
 * The day's calories and the macros they came in.
 *
 * The ring draws what has been eaten against the goal and nothing else. A
 * multi-segment ring covering eaten, burned and remaining is three statements
 * on one circle, and the three of them do not sum to it — burning 500 calories
 * does not shrink the plate. The legend beside it states each figure plainly
 * instead, which is the honest version of the same picture.
 *
 * The verdict line at the foot follows the figures: over the goal it says so,
 * because a card that congratulated a user either way would be worth nothing
 * on the day it mattered.
 */
export const CalorieSummaryCard = memo(
  ({
    consumed,
    goal,
    burned,
    proteinG,
    carbsG,
    fatsG,
    proteinGoalG,
    carbsGoalG,
    fatsGoalG,
    onPressLearnMore,
  }: Props) => {
    const { colors } = useTheme();
    const foreground = darkColors.tierForeground;
    const secondary = withAlpha(foreground, 0.68);

    const remaining = Math.max(0, goal - consumed);
    const isWithinGoal = consumed <= goal;

    return (
      <View style={[styles.panel, { backgroundColor: colors.tierBackground }]}>
        <HStack align="start" gap="base">
          <VStack flex={1} gap="md">
            <AppText variant="label" style={{ color: secondary }}>
              Calorie Summary
            </AppText>

            <HStack align="center" justify="center">
              <ProgressRing
                progress={consumed / Math.max(1, goal)}
                size={moderateScale(124)}
                strokeWidth={moderateScale(10)}
                tint={isWithinGoal ? darkColors.success : darkColors.destructive}
                trackColor={withAlpha(foreground, 0.16)}
              >
                <VStack align="center" gap="none">
                  <AppText variant="h2" numberOfLines={1} style={{ color: foreground }}>
                    {formatGrouped(consumed)}
                  </AppText>
                  <AppText variant="miniMicro" style={{ color: secondary }}>
                    {`/ ${formatGrouped(goal)} kcal`}
                  </AppText>
                </VStack>
              </ProgressRing>
            </HStack>

            <VStack gap="sm">
              <LegendRow
                label="Consumed"
                value={`${formatGrouped(consumed)} kcal`}
                tint={darkColors.destructive}
                foreground={foreground}
                secondary={secondary}
              />
              <LegendRow
                label="Burned"
                value={`${formatGrouped(burned)} kcal`}
                tint={darkColors.brandAccent}
                foreground={foreground}
                secondary={secondary}
              />
              <LegendRow
                label="Remaining"
                value={`${formatGrouped(remaining)} kcal`}
                tint={darkColors.success}
                foreground={foreground}
                secondary={secondary}
              />
            </VStack>
          </VStack>

          <VStack flex={1} gap="md">
            <AppText variant="label" style={{ color: secondary }}>
              Macronutrients
            </AppText>

            <MacroBar
              label="Carbs"
              value={carbsG}
              goal={carbsGoalG}
              tint={darkColors.success}
              foreground={foreground}
              secondary={secondary}
            />
            <MacroBar
              label="Protein"
              value={proteinG}
              goal={proteinGoalG}
              tint={darkColors.avatarPurple}
              foreground={foreground}
              secondary={secondary}
            />
            <MacroBar
              label="Fats"
              value={fatsG}
              goal={fatsGoalG}
              tint={darkColors.destructive}
              foreground={foreground}
              secondary={secondary}
            />
          </VStack>
        </HStack>

        <Divider tint={withAlpha(foreground, 0.14)} />

        <HStack align="center" justify="between" gap="sm">
          <HStack flex={1} align="center" gap="xs">
            <Icon
              as={Check}
              size="xs"
              tint={isWithinGoal ? darkColors.success : darkColors.destructive}
            />
            <AppText
              variant="micro"
              numberOfLines={2}
              style={[styles.verdict, { color: secondary }]}
            >
              {isWithinGoal
                ? "Great! You're within your daily calorie goal."
                : `That's ${formatGrouped(
                    consumed - goal,
                  )} kcal over today's goal.`}
            </AppText>
          </HStack>

          <Pressable
            onPress={onPressLearnMore}
            feedback="opacity"
            accessibilityRole="link"
            accessibilityLabel="Learn more about calories"
          >
            <HStack align="center" gap="xxs">
              <AppText variant="micro" style={{ color: foreground }}>
                Learn More
              </AppText>
              <Icon as={ChevronRight} size="xs" tint={foreground} />
            </HStack>
          </Pressable>
        </HStack>
      </View>
    );
  },
);

CalorieSummaryCard.displayName = 'CalorieSummaryCard';

const styles = StyleSheet.create({
  panel: { borderRadius: radius.xl, padding: spacing.base, gap: spacing.base },
  dot: { width: 8, height: 8, borderRadius: 4 },
  verdict: { flexShrink: 1 },
});
