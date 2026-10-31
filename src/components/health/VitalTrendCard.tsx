import React, { memo, useMemo } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { VitalKind, VitalReading } from '../../types/models';
import { axisLabel } from '../heart/HeartRateTrendCard';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { TrendLineChart, type TrendSeries } from './TrendLineChart';
import { VITAL_STYLE, formatVitalValue } from './vitals';

interface Props {
  kind: VitalKind;
  /** Oldest first, as the line is drawn. At least two, or there is no shape. */
  readings: VitalReading[];
}

/**
 * One vital's shape over its last few readings.
 *
 * The generic version of the heart rate screen's own trend card, for the
 * progress screen where all four sit in a column. Blood pressure draws two
 * lines on one scale — the pair is the reading, and two separate charts would
 * lose the distance between them, which is the thing a clinician looks at.
 *
 * The change is measured from the oldest reading drawn to the newest, and is
 * stated in the vital's own unit rather than as a percentage: "4 bpm lower"
 * is a fact about a pulse, where "5% lower" is arithmetic about a number.
 * Which direction counts as good is deliberately not said — that is a
 * clinical judgement, and weight alone has no right answer.
 */
export const VitalTrendCard = memo(({ kind, readings }: Props) => {
  const { colors } = useTheme();
  const { label, unit, tint } = VITAL_STYLE[kind];

  const series = useMemo<TrendSeries[]>(() => {
    const primary: TrendSeries = {
      id: `${kind}-primary`,
      tint: colors[tint],
      values: readings.map(reading => reading.value),
    };
    if (kind !== 'blood_pressure') return [primary];
    return [
      primary,
      {
        id: `${kind}-secondary`,
        tint: colors.textSecondary,
        values: readings.map(reading => reading.secondary ?? 0),
      },
    ];
  }, [colors, kind, readings, tint]);

  const labels = useMemo(
    () => readings.map(reading => axisLabel(reading.recordedAt)),
    [readings],
  );

  const newest = readings[readings.length - 1];
  const oldest = readings[0];
  const change = newest.value - oldest.value;
  // Rounded the way the figure itself is written, so a card never says a
  // change of 0.0 beside two numbers that visibly differ.
  const moved = kind === 'weight' || kind === 'bmi' ? Math.abs(change) >= 0.05 : Math.round(Math.abs(change)) >= 1;
  const written =
    kind === 'weight' || kind === 'bmi'
      ? Math.abs(change).toFixed(1)
      : String(Math.round(Math.abs(change)));

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <HStack align="center" justify="between" gap="sm">
          <VStack gap="xxs">
            <AppText variant="h3" numberOfLines={1}>
              {label}
            </AppText>
            <HStack align="baseline" gap="xs">
              <AppText variant="bodyStrong" style={{ color: colors[tint] }}>
                {`${formatVitalValue(newest)}${unit ? ` ${unit}` : ''}`}
              </AppText>
              <AppText variant="miniMicro" color="textTertiary">
                latest
              </AppText>
            </HStack>
          </VStack>

          <Chip
            label={`${readings.length} readings`}
            tint={colors.textSecondary}
          />
        </HStack>

        {moved ? (
          <HStack align="center" gap="xxs">
            <Icon
              as={change > 0 ? TrendingUp : TrendingDown}
              size="xs"
              color="textSecondary"
            />
            <AppText variant="micro" color="textSecondary" numberOfLines={1}>
              {`${written}${unit ? ` ${unit}` : ''} ${
                change > 0 ? 'higher' : 'lower'
              } than on ${axisLabel(oldest.recordedAt)}`}
            </AppText>
          </HStack>
        ) : (
          <AppText variant="micro" color="textSecondary" numberOfLines={1}>
            {`Steady since ${axisLabel(oldest.recordedAt)}`}
          </AppText>
        )}

        <TrendLineChart
          series={series}
          labels={labels}
          accessibilityLabel={`${label} over ${
            readings.length
          } readings, ${readings
            .map(reading => formatVitalValue(reading))
            .join(', ')}${unit ? ` ${unit}` : ''}`}
        />

        {kind === 'blood_pressure' ? (
          <HStack align="center" gap="base">
            <HStack align="center" gap="xxs">
              <AppText variant="miniMicro" style={{ color: colors[tint] }}>
                ●
              </AppText>
              <AppText variant="miniMicro" color="textTertiary">
                Systolic
              </AppText>
            </HStack>
            <HStack align="center" gap="xxs">
              <AppText
                variant="miniMicro"
                style={{ color: colors.textSecondary }}
              >
                ●
              </AppText>
              <AppText variant="miniMicro" color="textTertiary">
                Diastolic
              </AppText>
            </HStack>
          </HStack>
        ) : null}
      </VStack>
    </Card>
  );
});

VitalTrendCard.displayName = 'VitalTrendCard';
