import React, { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';

const PLOT_HEIGHT = moderateScale(120);
/** Room above and below the lines, so the highest dot is not clipped. */
const PADDING = moderateScale(12);
const DOT = 4;

export interface TrendSeries {
  id: string;
  /** The line's colour. Pass a theme colour. */
  tint: string;
  /** Oldest first, one per label. */
  values: number[];
}

interface Props {
  series: TrendSeries[];
  /** One per point, written under the plot. */
  labels: string[];
  /** What a screen reader should hear in place of the picture. */
  accessibilityLabel: string;
}

/**
 * One or more series over the same points, as lines.
 *
 * The scale is fitted to the values drawn rather than to a clinical range: a
 * resting pulse moves between about 60 and 80, and a chart drawn on 0–200
 * would be a flat line that says nothing. Every series shares that scale, so
 * two lines on one chart keep their true distance from each other.
 *
 * The plot is measured rather than calculated. The card sits inside the
 * screen's padding inside a scroll view, and a width derived from the window
 * would be wrong by however much of that chain changes.
 */
export const TrendLineChart = memo(
  ({ series, labels, accessibilityLabel }: Props) => {
    const { colors } = useTheme();
    const [width, setWidth] = useState(0);

    const handleLayout = useCallback(
      (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
      [],
    );

    const lines = useMemo(() => {
      const points = labels.length;
      if (points === 0 || width === 0) {
        return [];
      }

      const all = series.flatMap(entry => entry.values);
      const low = Math.min(...all);
      const high = Math.max(...all);
      // A flat run would divide by zero; give it a band to sit in the middle of.
      const span = high - low < 1 ? 10 : high - low;
      const base = high - low < 1 ? low - 5 : low;

      const step = points === 1 ? 0 : width / (points - 1);
      const usable = PLOT_HEIGHT - PADDING * 2;

      return series.map(entry => ({
        id: entry.id,
        tint: entry.tint,
        coords: entry.values.slice(0, points).map((value, index) => ({
          x: points === 1 ? width / 2 : index * step,
          y: PADDING + (1 - (value - base) / span) * usable,
        })),
      }));
    }, [labels.length, series, width]);

    return (
      <>
        <View
          onLayout={handleLayout}
          style={styles.plot}
          accessible
          accessibilityLabel={accessibilityLabel}
        >
          {width > 0 && lines.length > 0 ? (
            <Svg width={width} height={PLOT_HEIGHT}>
              {[PADDING, PLOT_HEIGHT / 2, PLOT_HEIGHT - PADDING].map(y => (
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

              {lines.map(line => (
                <React.Fragment key={line.id}>
                  <Polyline
                    points={line.coords.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={line.tint}
                    strokeWidth={3}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {line.coords.map(point => (
                    <Circle
                      key={`${line.id}-${point.x}`}
                      cx={point.x}
                      cy={point.y}
                      r={DOT}
                      fill={line.tint}
                    />
                  ))}
                </React.Fragment>
              ))}
            </Svg>
          ) : null}
        </View>

        <HStack align="center" justify="between">
          {labels.map((label, index) => (
            <AppText
              key={`${label}-${index}`}
              variant="miniMicro"
              color="textTertiary"
              numberOfLines={1}
            >
              {label}
            </AppText>
          ))}
        </HStack>
      </>
    );
  },
);

TrendLineChart.displayName = 'TrendLineChart';

const styles = StyleSheet.create({
  plot: { height: PLOT_HEIGHT, width: '100%' },
});
