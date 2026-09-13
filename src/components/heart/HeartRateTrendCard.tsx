import React, { memo, useMemo } from 'react';
import { useTheme } from '../../theme';
import type { VitalReading } from '../../types/models';
import { TrendLineChart } from '../health/TrendLineChart';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Sep 8" — the axis label under a point. */
export function axisLabel(recordedAt: string): string {
  const at = new Date(recordedAt);
  if (Number.isNaN(at.getTime())) {
    return '';
  }
  return `${MONTHS[at.getMonth()]} ${at.getDate()}`;
}

interface Props {
  /** Oldest first, as the line is drawn. */
  readings: VitalReading[];
  /** What the window is called — "7 Days". */
  periodLabel: string;
}

/**
 * The last few heart rate readings as a line.
 *
 * The figures are on the cards above and below; this is here to show the
 * shape. One series, in the heart's own colour.
 */
export const HeartRateTrendCard = memo(({ readings, periodLabel }: Props) => {
  const { colors } = useTheme();

  const series = useMemo(
    () => [
      {
        id: 'bpm',
        tint: colors.destructive,
        values: readings.map(reading => reading.value),
      },
    ],
    [colors.destructive, readings],
  );

  const labels = useMemo(
    () => readings.map(reading => axisLabel(reading.recordedAt)),
    [readings],
  );

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <HStack align="center" justify="between" gap="sm">
          <AppText variant="h3" numberOfLines={1}>
            Heart Rate Trend
          </AppText>
          <Chip label={periodLabel} tint={colors.textSecondary} />
        </HStack>

        <TrendLineChart
          series={series}
          labels={labels}
          accessibilityLabel={`Heart rate over the last ${
            readings.length
          } readings, ${readings
            .map(reading => `${Math.round(reading.value)}`)
            .join(', ')} beats per minute`}
        />
      </VStack>
    </Card>
  );
});

HeartRateTrendCard.displayName = 'HeartRateTrendCard';
