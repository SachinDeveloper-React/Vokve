import React, { memo } from 'react';
import Svg, {
  Defs,
  Ellipse,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';

/** Lucide's droplet silhouette, so it sits in the same family as the icons. */
const DROPLET =
  'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z';

/**
 * The pale end of the ramp. Written as literals rather than pulled from the
 * palette because the palette has no tint this light: water reads as water
 * through a highlight falling away into depth, and a single flat accent token
 * cannot express that — it renders as a blue paper cut-out.
 */
const RIM = '#EAF6FF';
const SHALLOW = '#8FCBFF';

interface Props {
  size?: number;
  /** Deep end of the ramp. Pass a theme colour, not a literal. */
  tint?: string;
}

/**
 * The card's hero glyph: a filled droplet rather than a badge with an outline
 * icon in it.
 *
 * A badge is the right frame for a metric that shares a row with three others
 * and needs to be told apart at a glance. Hydration owns its card, so the
 * droplet carries the identity on its own and the extra chrome would only
 * compete with the number beside it.
 */
export const WaterDroplet = memo(({ size, tint }: Props) => {
  const { colors } = useTheme();
  const box = size ?? moderateScale(52);

  return (
    <Svg width={box} height={box} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id="dropletFill" x1="0.25" y1="0" x2="0.85" y2="1">
          <Stop offset="0" stopColor={RIM} />
          <Stop offset="0.45" stopColor={SHALLOW} />
          <Stop offset="1" stopColor={tint ?? colors.primary} />
        </LinearGradient>
      </Defs>

      <Path d={DROPLET} fill="url(#dropletFill)" />

      {/* The specular highlight sits high on the left of the bulb, where a
          light source above and in front would put it. Without it the shape
          is a gradient, not a volume. */}
      <Ellipse
        cx="9.5"
        cy="14.4"
        rx="1.8"
        ry="2.7"
        fill="#FFFFFF"
        opacity={0.5}
        transform="rotate(-20 9.5 14.4)"
      />
    </Svg>
  );
});

WaterDroplet.displayName = 'WaterDroplet';
