import React, { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { VitalReading } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';

const PLOT_HEIGHT = moderateScale(120);
/** Room above and below the line, so the highest dot is not clipped. */
const PADDING = moderateScale(12);
const DOT = 4;

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
function axisLabel(recordedAt: string): string {
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
 * The last few readings as a line.
 *
 * Scaled to the readings themselves rather than to the 0–200 the bands cover:
 * a resting pulse moves between about 60 and 80, and a chart drawn on the full
 * clinical scale would be a flat line that says nothing. The figures are on
 * the card above; this is here to show the shape.
 *
 * The plot is measured rather than calculated. The card sits inside the
 * screen's padding inside a scroll view, and a width derived from the window
 * would be wrong by however much of that chain changes.
 */
export const HeartRateTrendCard = memo(({ readings, periodLabel }: Props) => {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
    [],
  );

  const { points, gridlines } = useMemo(() => {
    if (readings.length === 0 || width === 0) {
      return { points: '', gridlines: [] as number[] };
    }

    const values = readings.map(reading => reading.value);
    const low = Math.min(...values);
    const high = Math.max(...values);
    // A flat run would divide by zero; give it a band to sit in the middle of.
    const span = high - low < 1 ? 10 : high - low;
    const base = high - low < 1 ? low - 5 : low;

    const step = readings.length === 1 ? 0 : width / (readings.length - 1);
    const usable = PLOT_HEIGHT - PADDING * 2;

    const coords = readings.map((reading, index) => {
      const x = readings.length === 1 ? width / 2 : index * step;
      const y = PADDING + (1 - (reading.value - base) / span) * usable;
      return { x, y };
    });

    return {
      points: coords.map(point => `${point.x},${point.y}`).join(' '),
      gridlines: [PADDING, PLOT_HEIGHT / 2, PLOT_HEIGHT - PADDING],
    };
  }, [readings, width]);

  const coords = useMemo(
    () =>
      points
        .split(' ')
        .filter(Boolean)
        .map(pair => {
          const [x, y] = pair.split(',').map(Number);
          return { x, y };
        }),
    [points],
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

        <View
          onLayout={handleLayout}
          style={styles.plot}
          accessible
          accessibilityLabel={`Heart rate over the last ${
            readings.length
          } readings, ${readings
            .map(reading => `${Math.round(reading.value)}`)
            .join(', ')} beats per minute`}
        >
          {width > 0 && readings.length > 0 ? (
            <Svg width={width} height={PLOT_HEIGHT}>
              {gridlines.map(y => (
                <Line
                  key={y}
                  x1={0}
                  y1={y}
                  x2={width}
                  y2={y}
                  stroke={withAlpha(colors.border, 0.8)}
                  strokeWidth={1}
                />
              ))}

              <Polyline
                points={points}
                fill="none"
                stroke={colors.destructive}
                strokeWidth={3}
                strokeLinejoin="round"
                strokeLinecap="round"
              />

              {coords.map(point => (
                <Circle
                  key={`${point.x}-${point.y}`}
                  cx={point.x}
                  cy={point.y}
                  r={DOT}
                  fill={colors.destructive}
                />
              ))}
            </Svg>
          ) : null}
        </View>

        <HStack align="center" justify="between">
          {readings.map(reading => (
            <AppText
              key={reading.id}
              variant="miniMicro"
              color="textTertiary"
              numberOfLines={1}
            >
              {axisLabel(reading.recordedAt)}
            </AppText>
          ))}
        </HStack>
      </VStack>
    </Card>
  );
});

HeartRateTrendCard.displayName = 'HeartRateTrendCard';

const styles = StyleSheet.create({
  plot: { height: PLOT_HEIGHT, width: '100%' },
});
