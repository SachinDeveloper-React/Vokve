import React, { memo } from 'react';
import { formatGrouped } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { ProgressBar } from '../ui/ProgressBar';

interface Props {
  label: string;
  /** Grams eaten so far. */
  value: number;
  /** Grams the goal asks for. */
  goal: number;
  /** The macro's colour. Pass a theme colour. */
  tint: string;
  /** Drawn on the dark summary panel, so the labels take its foreground. */
  foreground: string;
  secondary: string;
}

/**
 * One macronutrient's progress towards its target.
 *
 * The grams are stated as well as drawn. A bar answers "how far along" at a
 * glance; "85g / 120g" answers "how much more", which is the question somebody
 * planning dinner is actually asking.
 */
export const MacroBar = memo(
  ({ label, value, goal, tint, foreground, secondary }: Props) => (
    <VStack
      gap="xxs"
      accessible
      accessibilityLabel={`${label}, ${Math.round(value)} of ${Math.round(
        goal,
      )} grams`}
    >
      <HStack align="center" justify="between" gap="sm">
        <AppText variant="micro" numberOfLines={1} style={{ color: foreground }}>
          {label}
        </AppText>
        <AppText variant="miniMicro" numberOfLines={1} style={{ color: secondary }}>
          {`${formatGrouped(value)}g / ${formatGrouped(goal)}g`}
        </AppText>
      </HStack>

      <ProgressBar progress={value / Math.max(1, goal)} tint={tint} height={6} />
    </VStack>
  ),
);

MacroBar.displayName = 'MacroBar';
