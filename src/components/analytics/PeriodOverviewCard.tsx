import React, { memo } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { formatActiveTime, formatGrouped } from '../../utils/format';
import { Card } from '../ui/Card';
import { AppText } from '../ui/AppText';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { ChipTrack, type Chip } from './ChipTrack';

/** The rolling windows the overview can be read over. */
export type AnalyticsPeriod = '7d' | '14d' | '30d';

/** How many days each window covers. The one source for the query and the maths. */
export const PERIOD_DAYS: Record<AnalyticsPeriod, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
};

const PERIODS: readonly Chip<AnalyticsPeriod>[] = [
  { value: '7d', label: '7D', name: '7 days' },
  { value: '14d', label: '14D', name: '14 days' },
  { value: '30d', label: '30D', name: '30 days' },
];

export interface PeriodTotals {
  steps: number;
  distanceKm: number;
  caloriesBurned: number;
  activeMinutes: number;
  /** Days of the window with at least one step. */
  activeDays: number;
}

interface FigureProps {
  value: string;
  label: string;
}

const PeriodFigure = memo(({ value, label }: FigureProps) => (
  <VStack
    flex={1}
    align="center"
    gap="xxs"
    accessible
    accessibilityLabel={`${label}, ${value}`}
  >
    <AppText variant="bodyStrong" numberOfLines={1}>
      {value}
    </AppText>
    <AppText variant="miniMicro" color="textTertiary" numberOfLines={1}>
      {label}
    </AppText>
  </VStack>
));

PeriodFigure.displayName = 'PeriodFigure';

interface Props {
  value: AnalyticsPeriod;
  onChange: (value: AnalyticsPeriod) => void;
  /** The dates the window covers, already worded. */
  caption: string;
  totals: PeriodTotals | null;
  /** Days of the window whose count reached the goal. */
  goalDays: number;
  /**
   * The same length of time immediately before this window, for the
   * comparison line. Null when the server has not answered for it.
   */
  previousSteps: number | null;
}

/**
 * The window, totalled.
 *
 * Rolling, where the chart above is on calendar periods: "the last 30 days"
 * is the question someone actually asks of their own walking, and the first
 * of the month is an accident of the calendar. The two controls therefore
 * stay separate — this one moves the window, the one at the top of the
 * screen moves the day everything else is anchored to.
 *
 * The daily average divides by the window, never by the days that happened
 * to have steps on them: an average over "the days I walked" flatters a week
 * with two walks in it, and the days that were missed are the point of the
 * figure. `activeDays` is stated beside it so nothing is hidden by that.
 *
 * The comparison is against the same length of time immediately before,
 * which is the only honest counterpart: a 30-day window compared with last
 * month would be comparing 30 days with 28 some of the year.
 */
export const PeriodOverviewCard = memo(
  ({ value, onChange, caption, totals, goalDays, previousSteps }: Props) => {
    const { colors } = useTheme();
    const days = PERIOD_DAYS[value];

    const steps = totals?.steps ?? 0;
    const average = Math.round(steps / days);

    const delta =
      previousSteps === null || previousSteps === 0
        ? null
        : Math.round(((steps - previousSteps) / previousSteps) * 100);
    const isUp = (delta ?? 0) >= 0;

    return (
      <Card elevation="low" radius="xl">
        <VStack gap="base">
          <HStack align="center" justify="between" gap="sm">
            <AppText variant="label" color="textSecondary">
              Period Overview
            </AppText>

            <ChipTrack chips={PERIODS} value={value} onChange={onChange} />
          </HStack>

          <AppText variant="micro" color="textTertiary">
            {`${caption} · active on ${totals?.activeDays ?? 0} of ${days} days`}
          </AppText>

          <HStack align="start" justify="between" gap="base">
            <VStack gap="xxs">
              <HStack align="baseline" gap="xs">
                <AppText variant="h1" numberOfLines={1}>
                  {formatGrouped(steps)}
                </AppText>
                <AppText variant="micro" color="textTertiary">
                  steps
                </AppText>
              </HStack>

              {delta === null ? (
                <AppText variant="micro" color="textTertiary">
                  {`Over the last ${days} days`}
                </AppText>
              ) : (
                <HStack align="center" gap="xxs">
                  <Icon
                    as={isUp ? TrendingUp : TrendingDown}
                    size="xs"
                    tint={isUp ? colors.success : colors.destructive}
                  />
                  <AppText
                    variant="micro"
                    numberOfLines={1}
                    style={{ color: isUp ? colors.success : colors.destructive }}
                  >
                    {`${Math.abs(delta)}% ${
                      isUp ? 'more' : 'less'
                    } than the ${days} days before`}
                  </AppText>
                </HStack>
              )}
            </VStack>

            <VStack align="end" gap="xxs">
              <AppText variant="bodyStrong" numberOfLines={1}>
                {formatGrouped(average)}
              </AppText>
              <AppText variant="miniMicro" color="textTertiary">
                Daily average
              </AppText>
            </VStack>
          </HStack>

          <Divider />

          <HStack align="start" gap="sm">
            <PeriodFigure
              value={`${(totals?.distanceKm ?? 0).toFixed(1)} km`}
              label="Distance"
            />
            <PeriodFigure
              value={formatGrouped(Math.round(totals?.caloriesBurned ?? 0))}
              label="Calories"
            />
            <PeriodFigure
              value={formatActiveTime(totals?.activeMinutes ?? 0)}
              label="Active Time"
            />
            <PeriodFigure value={`${goalDays} / ${days}`} label="Goal Met" />
          </HStack>
        </VStack>
      </Card>
    );
  },
);

PeriodOverviewCard.displayName = 'PeriodOverviewCard';
