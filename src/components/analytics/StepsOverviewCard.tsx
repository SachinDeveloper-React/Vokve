import React, { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { formatGrouped } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

/** Tallest a bar can be drawn. */
const BAR_MAX = moderateScale(120);

export interface OverviewPoint {
  /** What the bar covers — an hour, a weekday, a week, a month. */
  label: string;
  steps: number;
}

interface BarProps {
  point: OverviewPoint;
  fraction: number;
  /** Every other bar is drawn a shade back, so a dense series stays countable. */
  alternate: boolean;
}

const OverviewBar = memo(({ point, fraction, alternate }: BarProps) => {
  const { colors } = useTheme();

  return (
    <View
      style={styles.column}
      accessible
      accessibilityLabel={`${point.label}, ${formatGrouped(point.steps)} steps`}
    >
      <View
        style={[
          styles.bar,
          {
            height: Math.max(2, fraction * BAR_MAX),
            backgroundColor: alternate
              ? withAlpha(colors.brandAccent, 0.55)
              : colors.brandAccent,
          },
        ]}
      />
    </View>
  );
});

OverviewBar.displayName = 'OverviewBar';

interface Props {
  points: OverviewPoint[];
  /** What the series covers, dated — "Today · 27 October 2026, hour by hour". */
  caption: string;
  /**
   * How many bars one axis label stands for. One per bar by default; a day of
   * twenty-four hourly bars passes 4 and gets a label every fourth hour.
   */
  labelEvery?: number;
  onPressInsights: () => void;
}

/**
 * The period's steps, bar by bar.
 *
 * No value above each bar, unlike the dashboard's seven-day chart: this series
 * can be twenty-four columns wide, and twenty-four numbers across a 375pt
 * screen is a texture rather than a reading. What each bar is worth is in its
 * accessibility label, and the shape is what the card is for.
 *
 * The axis is drawn as one cell per label, each the same width, so a label
 * always sits under the bars it names: every label comes from a bar's own
 * label rather than from a list passed in beside the series, which is what
 * used to let the two drift apart as soon as the period changed length. A
 * dense series labels every nth bar instead of every one — twenty-four hours
 * of "12 AM" across a 375pt screen would overlap into a smudge.
 */
export const StepsOverviewCard = memo(
  ({ points, caption, labelEvery = 1, onPressInsights }: Props) => {
    const { colors } = useTheme();
    const foreground = darkColors.tierForeground;

    const peak = useMemo(
      () => Math.max(1, ...points.map(point => point.steps)),
      [points],
    );

    const ticks = useMemo(() => {
      const step = Math.max(1, Math.round(labelEvery));
      return points
        .filter((_, index) => index % step === 0)
        .map((point, index) => ({
          key: `${index}-${point.label}`,
          label: point.label,
        }));
    }, [points, labelEvery]);

    return (
      <View style={[styles.panel, { backgroundColor: colors.tierBackground }]}>
        <HStack align="center" justify="between" gap="sm">
          <VStack flex={1} gap="xxs">
            <AppText
              variant="label"
              numberOfLines={1}
              style={{ color: withAlpha(foreground, 0.72) }}
            >
              Steps Overview
            </AppText>
            <AppText
              variant="miniMicro"
              // Two lines: the caption carries the period's dates, which a
              // single line truncates on a 375pt screen beside the link.
              numberOfLines={2}
              style={{ color: withAlpha(foreground, 0.56) }}
            >
              {caption}
            </AppText>
          </VStack>

          <Pressable
            onPress={onPressInsights}
            feedback="opacity"
            accessibilityRole="link"
            accessibilityLabel="View insights"
          >
            <HStack align="center" gap="xxs">
              <AppText variant="micro" style={{ color: colors.primary }}>
                View Insights
              </AppText>
              <Icon as={ChevronRight} size="xs" tint={colors.primary} />
            </HStack>
          </Pressable>
        </HStack>

        <HStack align="end" gap="xxs" style={styles.plot}>
          {points.map((point, index) => (
            <OverviewBar
              key={`${index}-${point.label}`}
              point={point}
              fraction={point.steps / peak}
              alternate={index % 2 === 1}
            />
          ))}
        </HStack>

        <HStack align="center">
          {ticks.map(tick => (
            <AppText
              key={tick.key}
              variant="miniMicro"
              numberOfLines={1}
              center
              style={[styles.tick, { color: withAlpha(foreground, 0.56) }]}
            >
              {tick.label}
            </AppText>
          ))}
        </HStack>
      </View>
    );
  },
);

StepsOverviewCard.displayName = 'StepsOverviewCard';

const styles = StyleSheet.create({
  panel: { borderRadius: radius.xl, padding: spacing.base, gap: spacing.md },
  plot: { height: BAR_MAX },
  column: { flex: 1, justifyContent: 'flex-end' },
  // Equal cells: the nth label lands over the nth group of bars.
  tick: { flex: 1 },
  bar: { width: '100%', borderRadius: radius.pill },
});
