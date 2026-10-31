import React, { memo } from 'react';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';

/**
 * The pale end of the ramp, as in `WaterDroplet`. Written as literals rather
 * than pulled from the palette for the same reason: the palette has no tint
 * this light, and water without a highlight reads as a blue paper cut-out.
 */
const RIM = '#CFE9FF';
const SHALLOW = '#7FC0FF';

/** The glass's inner box in the 64 × 96 viewport, which the fill is measured in. */
const INNER = { x: 10, y: 10, width: 44, height: 76 };

/** The outline, in the viewport's own units — what the hero glass is drawn with. */
const STROKE = 2.5;
/**
 * The thinnest that outline may come out on screen, in points.
 *
 * A viewport unit is `height / 96` points, so the hero's 2.5 lands at 2.5pt
 * on a 96pt glass and at a quarter of a point on a 15pt one — which is to say
 * nothing at all. Below the size where those agree the stroke is widened in
 * user units to hold this on screen, so the same glass reads at any size
 * without a second drawing of it.
 */
const MIN_STROKE_PT = 1.1;

interface Props {
  /** 0–1. Values outside are clamped, so an exceeded goal reads as full. */
  progress: number;
  size?: number;
}

/**
 * A glass filling up as the day's water goes in.
 *
 * A glass at a glance says how the day is going in a way a percentage has to
 * be read to, which is what lets the progress bar under the figures stay a
 * thin line. It is decorative — every figure it draws is stated in words
 * beside it — so it is hidden from the screen reader by the card that owns it.
 *
 * Drawn once and used at every size the app needs a glass at: the hero on the
 * water screen, the dashboard's smaller one, and the row of glasses counting
 * the day out (`HydrationPip`). Only the stroke needs looking after as it
 * shrinks; see `MIN_STROKE_PT`.
 */
export const WaterGlass = memo(({ progress, size }: Props) => {
  const { colors } = useTheme();
  const height = size ?? moderateScale(96);
  const width = (height * 64) / 96;

  const filled = Math.min(1, Math.max(0, progress));
  const fillHeight = INNER.height * filled;
  const stroke = Math.max(STROKE, (MIN_STROKE_PT * 96) / height);

  return (
    <Svg width={width} height={height} viewBox="0 0 64 96">
      <Defs>
        <LinearGradient id="glassWater" x1="0" y1="0" x2="0.6" y2="1">
          <Stop offset="0" stopColor={RIM} />
          <Stop offset="0.4" stopColor={SHALLOW} />
          <Stop offset="1" stopColor={colors.primary} />
        </LinearGradient>
      </Defs>

      {/* Drawn from the bottom up: the water's top edge is what moves. */}
      <Rect
        x={INNER.x}
        y={INNER.y + INNER.height - fillHeight}
        width={INNER.width}
        height={fillHeight}
        rx={6}
        fill="url(#glassWater)"
      />

      {/* The glass itself last, so its rim sits over the water rather than
          under it — a tumbler tapering very slightly towards the base. */}
      <Path
        d="M8 8 h48 l-4 80 a4 4 0 0 1 -4 4 h-32 a4 4 0 0 1 -4 -4 z"
        fill="none"
        stroke={colors.text}
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
    </Svg>
  );
});

WaterGlass.displayName = 'WaterGlass';
