import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { formatGrouped } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { ProgressRing } from '../fitness/ProgressRing';
import { MacroBar } from './MacroBar';

interface LegendProps {
  label: string;
  value: number;
  tint: string;
  foreground: string;
  secondary: string;
}

/**
 * One of the day's three calorie figures, as a column in a row of three.
 *
 * Across rather than down: the three together are one reading of the day, and
 * stacked they cost three lines of a card that already carries a ring and
 * three macro bars. Side by side they take one, and the eye compares them
 * without having to travel.
 *
 * The unit is said once per figure but a step smaller than the number, so the
 * three numbers line up as a row of numbers rather than a row of sentences.
 */
const LegendFigure = memo(
  ({ label, value, tint, foreground, secondary }: LegendProps) => (
    <VStack
      flex={1}
      align="center"
      gap="xxs"
      accessible
      accessibilityLabel={`${label}, ${formatGrouped(value)} kcal`}
    >
      <HStack align="center" gap="xs">
        <View style={[styles.dot, { backgroundColor: tint }]} />
        <AppText variant="micro" numberOfLines={1} style={{ color: secondary }}>
          {label}
        </AppText>
      </HStack>

      <HStack align="baseline" gap="xxs">
        <AppText
          variant="bodyStrong"
          numberOfLines={1}
          style={{ color: foreground }}
        >
          {formatGrouped(value)}
        </AppText>
        <AppText variant="miniMicro" style={{ color: secondary }}>
          kcal
        </AppText>
      </HStack>
    </VStack>
  ),
);

LegendFigure.displayName = 'LegendFigure';

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
}

/**
 * The day's calories and the macros they came in.
 *
 * The ring draws what has been eaten against the goal and nothing else. A
 * multi-segment ring covering eaten, burned and remaining is three statements
 * on one circle, and the three of them do not sum to it — burning 500 calories
 * does not shrink the plate. The three figures are stated plainly in a band
 * under the ring instead, which is the honest version of the same picture.
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
  }: Props) => {
    const { colors } = useTheme();
    const foreground = darkColors.tierForeground;
    const secondary = withAlpha(foreground, 0.68);
    const rule = withAlpha(foreground, 0.14);

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
                tint={
                  isWithinGoal ? darkColors.success : darkColors.destructive
                }
                trackColor={withAlpha(foreground, 0.16)}
              >
                <VStack align="center" gap="none">
                  <AppText
                    variant="h2"
                    numberOfLines={1}
                    style={{ color: foreground }}
                  >
                    {formatGrouped(consumed)}
                  </AppText>
                  <AppText variant="miniMicro" style={{ color: secondary }}>
                    {`/ ${formatGrouped(goal)} kcal`}
                  </AppText>
                </VStack>
              </ProgressRing>
            </HStack>
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

        <Divider tint={rule} />

        {/* The three figures across the full width of the card rather than
            down one half of it: a third of the card is room enough for a
            four-figure number, and half a card's width was never the
            constraint on reading them — the three lines were. */}
        <HStack align="start" gap="xs">
          <LegendFigure
            label="Consumed"
            value={consumed}
            tint={darkColors.destructive}
            foreground={foreground}
            secondary={secondary}
          />
          <Divider orientation="vertical" tint={rule} />
          <LegendFigure
            label="Burned"
            value={burned}
            tint={darkColors.brandAccent}
            foreground={foreground}
            secondary={secondary}
          />
          <Divider orientation="vertical" tint={rule} />
          <LegendFigure
            label="Remaining"
            value={remaining}
            tint={darkColors.success}
            foreground={foreground}
            secondary={secondary}
          />
        </HStack>

        <Divider tint={rule} />

        {/* The verdict had a "Learn More" link beside it, wired to a screen
            that does not exist. A control that does nothing costs more than
            the space it saves, so the sentence has the width instead. */}
        <HStack align="center" gap="xs">
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
      </View>
    );
  },
);

CalorieSummaryCard.displayName = 'CalorieSummaryCard';

const styles = StyleSheet.create({
  panel: { borderRadius: radius.xl, padding: spacing.base, gap: spacing.md },
  dot: { width: 6, height: 6, borderRadius: 3 },
  verdict: { flexShrink: 1 },
});
