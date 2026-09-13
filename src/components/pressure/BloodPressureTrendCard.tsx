import React, { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import type { VitalReading } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { TrendLineChart } from '../health/TrendLineChart';
import { axisLabel } from '../heart/HeartRateTrendCard';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';

interface LegendProps {
  label: string;
  tint: string;
}

const LegendItem = memo(({ label, tint }: LegendProps) => (
  <HStack align="center" gap="xs">
    <View style={[styles.swatch, { backgroundColor: tint }]} />
    <AppText variant="miniMicro" style={{ color: tint }}>
      {label}
    </AppText>
  </HStack>
));

LegendItem.displayName = 'LegendItem';

interface Props {
  /** Oldest first, as the lines are drawn. */
  readings: VitalReading[];
  /** What the window is called — "7 Days". */
  periodLabel: string;
}

/**
 * The last few readings as two lines, systolic over diastolic.
 *
 * Both on one scale, so the gap between the lines is the real gap between the
 * two numbers: a chart that scaled each line to its own range would show the
 * pair moving together whether or not they did. A legend is needed here where
 * the heart's chart needs none, because there are two lines to tell apart.
 */
export const BloodPressureTrendCard = memo(
  ({ readings, periodLabel }: Props) => {
    const { colors } = useTheme();
    const systolicTint = withAlpha(colors.primary, 0.6);
    const diastolicTint = colors.primary;

    const series = useMemo(
      () => [
        {
          id: 'sys',
          tint: systolicTint,
          values: readings.map(reading => reading.value),
        },
        {
          id: 'dia',
          tint: diastolicTint,
          values: readings.map(reading => reading.secondary ?? 0),
        },
      ],
      [diastolicTint, readings, systolicTint],
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
              Blood Pressure Trend
            </AppText>
            <Chip label={periodLabel} tint={colors.textSecondary} />
          </HStack>

          <HStack align="center" justify="end" gap="base">
            <LegendItem label="SYS" tint={systolicTint} />
            <LegendItem label="DIA" tint={diastolicTint} />
          </HStack>

          <TrendLineChart
            series={series}
            labels={labels}
            accessibilityLabel={`Blood pressure over the last ${
              readings.length
            } readings, ${readings
              .map(
                reading =>
                  `${Math.round(reading.value)} over ${Math.round(
                    reading.secondary ?? 0,
                  )}`,
              )
              .join(', ')}`}
          />
        </VStack>
      </Card>
    );
  },
);

BloodPressureTrendCard.displayName = 'BloodPressureTrendCard';

const styles = StyleSheet.create({
  swatch: { width: 10, height: 10, borderRadius: 5 },
});
