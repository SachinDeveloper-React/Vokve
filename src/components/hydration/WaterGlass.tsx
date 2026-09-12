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

interface Props {
  /** 0–1. Values outside are clamped, so an exceeded goal reads as full. */
  progress: number;
  size?: number;
}

/**
 * A glass filling up as the day's water goes in.
 *
 * The one picture on the screen, and the reason the progress bar under the
 * figures can stay a thin line: a glass at a glance says how the day is going
 * in a way a percentage has to be read to. It is decorative — every figure it
 * draws is stated in words beside it — so it is hidden from the screen reader
 * by the card that owns it.
 */
export const WaterGlass = memo(({ progress, size }: Props) => {
  const { colors } = useTheme();
  const height = size ?? moderateScale(96);
  const width = (height * 64) / 96;

  const filled = Math.min(1, Math.max(0, progress));
  const fillHeight = INNER.height * filled;

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
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
});

WaterGlass.displayName = 'WaterGlass';
