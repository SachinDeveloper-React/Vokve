import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sparkles, TrendingDown, TrendingUp } from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { formatGrouped } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface FigureProps {
  value: string;
  label: string;
}

const SummaryFigure = memo(({ value, label }: FigureProps) => {
  const foreground = darkColors.tierForeground;

  return (
    <VStack
      flex={1}
      align="center"
      gap="xxs"
      accessible
      accessibilityLabel={`${label}, ${value}`}
    >
      <AppText variant="bodyStrong" numberOfLines={1} style={{ color: foreground }}>
        {value}
      </AppText>
      <AppText
        variant="miniMicro"
        numberOfLines={1}
        style={{ color: withAlpha(foreground, 0.64) }}
      >
        {label}
      </AppText>
    </VStack>
  );
});

SummaryFigure.displayName = 'SummaryFigure';

interface Props {
  steps: number;
  goal: number;
  /** Yesterday's count, for the line under the figure. Null when unknown. */
  previousSteps: number | null;
  caloriesBurned: number;
  distanceKm: number;
  activeMinutes: number;
  onPressReport: () => void;
}

/** "1h 32m", or "48m" while the day is still short. */
function formatActiveTime(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  return hours > 0 ? `${hours}h ${whole % 60}m` : `${whole}m`;
}

/**
 * Today's step count, what it is worth against the goal, and the four figures
 * that come with it.
 *
 * The comparison line reads in whichever direction the day actually went. A
 * card that only ever said "more than yesterday" would be wrong half the time,
 * and the arrow beside it carries the direction for a reader who cannot tell
 * the green from the red.
 */
export const StepsSummaryCard = memo(
  ({
    steps,
    goal,
    previousSteps,
    caloriesBurned,
    distanceKm,
    activeMinutes,
    onPressReport,
  }: Props) => {
    const { colors } = useTheme();
    const foreground = darkColors.tierForeground;
    const secondary = withAlpha(foreground, 0.64);

    const percent = Math.round((steps / Math.max(1, goal)) * 100);

    const delta =
      previousSteps === null || previousSteps === 0
        ? null
        : Math.round(((steps - previousSteps) / previousSteps) * 100);
    const isUp = (delta ?? 0) >= 0;

    return (
      <View style={[styles.panel, { backgroundColor: colors.tierBackground }]}>
        <HStack align="start" gap="base">
          <VStack flex={1} gap="xxs">
            <AppText variant="label" style={{ color: secondary }}>
              Total Steps
            </AppText>

            <HStack align="baseline" gap="sm" wrap>
              <AppText variant="display" numberOfLines={1} style={{ color: foreground }}>
                {formatGrouped(steps)}
              </AppText>
              <AppText variant="body" style={{ color: secondary }}>
                steps
              </AppText>
            </HStack>

            {delta === null ? null : (
              <HStack align="center" gap="xxs">
                <Icon
                  as={isUp ? TrendingUp : TrendingDown}
                  size="xs"
                  tint={isUp ? darkColors.success : darkColors.destructive}
                />
                <AppText
                  variant="micro"
                  numberOfLines={1}
                  style={{ color: isUp ? darkColors.success : darkColors.destructive }}
                >
                  {`${Math.abs(delta)}% ${isUp ? 'more' : 'less'} than yesterday`}
                </AppText>
              </HStack>
            )}
          </VStack>

          <VStack align="end" gap="xxs">
            <AppText variant="label" style={{ color: secondary }}>
              Daily Goal
            </AppText>
            <AppText variant="h1" numberOfLines={1} style={{ color: foreground }}>
              {`${percent}%`}
            </AppText>
            <AppText variant="micro" style={{ color: secondary }}>
              of Goal
            </AppText>
          </VStack>
        </HStack>

        <Divider tint={withAlpha(foreground, 0.14)} />

        <HStack align="center" gap="sm">
          <SummaryFigure
            value={String(Math.round(caloriesBurned))}
            label="Calories"
          />
          <SummaryFigure value={distanceKm.toFixed(1)} label="km" />
          <SummaryFigure
            value={formatActiveTime(activeMinutes)}
            label="Active Time"
          />

          <Pressable
            onPress={onPressReport}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel="AI report"
            style={styles.report}
          >
            <VStack align="center" gap="xxs">
              <HStack align="center" gap="xxs">
                <Icon as={Sparkles} size="xs" tint={colors.brandAccent} />
                <AppText
                  variant="bodyStrong"
                  numberOfLines={1}
                  style={{ color: colors.brandAccent }}
                >
                  AI
                </AppText>
              </HStack>
              <AppText
                variant="miniMicro"
                numberOfLines={1}
                style={{ color: withAlpha(foreground, 0.64) }}
              >
                Report
              </AppText>
            </VStack>
          </Pressable>
        </HStack>
      </View>
    );
  },
);

StepsSummaryCard.displayName = 'StepsSummaryCard';

const styles = StyleSheet.create({
  panel: { borderRadius: radius.xl, padding: spacing.base, gap: spacing.base },
  report: { flex: 1 },
});
