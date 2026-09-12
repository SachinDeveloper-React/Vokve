import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { ProgressBar } from '../ui/ProgressBar';
import { WaterDroplet } from '../fitness/WaterDroplet';
import { WaterGlass } from './WaterGlass';

interface Props {
  consumedMl: number;
  goalMl: number;
}

const litres = (ml: number) => `${(ml / 1000).toFixed(1)} L`;

/**
 * How the day is going, in one panel.
 *
 * The encouragement at the foot changes with the figure above it rather than
 * being a fixed slogan: a line that says "keep it up" to somebody who has not
 * drunk anything all day is the kind of praise that teaches a user to stop
 * reading the screen.
 */
function encouragementFor(percent: number): string {
  if (percent >= 100) return "Goal smashed. Nicely done! 💧";
  if (percent >= 70) return "Keep it up! You're doing great. 💧";
  if (percent >= 30) return 'Good start — keep the glasses coming. 💧';
  return 'Time for your first glass. 💧';
}

/**
 * The screen's hero: today's intake against the goal.
 *
 * Three readings of the same fact, each for a different reader: the litres for
 * someone checking a number, the percentage for someone checking how close
 * they are, and the glass for someone who only glanced. The bar is deliberately
 * the thinnest of them — it repeats the percentage, and two loud meters of the
 * same figure would leave nothing to read first.
 */
export const HydrationProgressCard = memo(({ consumedMl, goalMl }: Props) => {
  const { colors, isDark } = useTheme();
  const safeGoal = Math.max(1, goalMl);
  const progress = consumedMl / safeGoal;
  const percent = Math.round(progress * 100);

  return (
    <Box
      radius="xl"
      p="base"
      style={{ backgroundColor: withAlpha(colors.primary, isDark ? 0.16 : 0.08) }}
    >
      <HStack align="center" gap="base">
        <VStack flex={1} gap="sm">
          <HStack align="center" gap="sm">
            <WaterDroplet size={20} />
            <AppText variant="bodyStrong">Today's Progress</AppText>
          </HStack>

          {/* Baseline-aligned, which sets "of 3.0 L" on the same line as the
              figure it qualifies instead of centring it against a taller glyph. */}
          <HStack align="baseline" gap="sm" wrap>
            <AppText variant="metric" color="primary">
              {litres(consumedMl)}
            </AppText>
            <AppText variant="body" color="textSecondary">
              {`of ${litres(goalMl)}`}
            </AppText>
          </HStack>

          <HStack align="center" gap="sm">
            <AppText variant="bodyStrong">{`${percent}%`}</AppText>
            <AppText variant="bodyStrong" color="textSecondary">
              Goal Achieved
            </AppText>
          </HStack>

          <ProgressBar progress={progress} tint={colors.primary} />

          <AppText variant="micro" numberOfLines={2}>
            {encouragementFor(percent)}
          </AppText>
        </VStack>

        {/* Decorative: every figure it draws is stated in words beside it. */}
        <Box
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <WaterGlass progress={progress} />
        </Box>
      </HStack>
    </Box>
  );
});

HydrationProgressCard.displayName = 'HydrationProgressCard';
