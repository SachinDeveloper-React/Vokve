import React, { memo } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';

const WIDTH = moderateScale(180);
const HEIGHT = moderateScale(200);
const VIEW_BOX = '0 0 180 200';

/** The handset outline. */
const PHONE = { x: 52, y: 8, w: 76, h: 184, r: 14 };
/** Its earpiece slot. */
const SPEAKER = { x: 78, y: 20, w: 24, h: 4, r: 2 };
/** The badge tile the shield sits on. */
const TILE = { x: 68, y: 76, w: 44, h: 44, r: 12 };

/**
 * Motion lines to the left of the handset — the code arriving.
 *
 * Staggered lengths rather than three equal dashes: equal lines read as a
 * menu icon, and the taper is what makes them read as movement.
 */
const SPEED_LINES = [
  { y: 88, x1: 20, x2: 46 },
  { y: 97, x1: 12, x2: 46 },
  { y: 106, x1: 24, x2: 46 },
];

/** A shield with a tick, drawn in the tile's own 24-unit box. */
const SHIELD =
  'M12 2.6 4.8 5.8v5.6c0 4.5 3.1 8.7 7.2 9.9 4.1-1.2 7.2-5.4 7.2-9.9V5.8L12 2.6z';
const TICK = 'M8.6 11.9l2.4 2.4 4.4-4.6';

interface Props {
  style?: StyleProp<ViewStyle>;
}

/**
 * The illustration above "Verify Your Number" — a code landing on a handset.
 *
 * Drawn as SVG rather than shipped as a PNG so it takes the theme's colours:
 * the handset outline has to be a *border* colour to stay visible in both
 * schemes, where a flat exported asset would disappear against one of them.
 * The tile keeps the brand orange in both, being the one element that is
 * meant to hold its own against the background.
 */
export const VerificationHeroArt = memo(({ style }: Props) => {
  const { colors } = useTheme();

  return (
    <View
      style={style}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={WIDTH} height={HEIGHT} viewBox={VIEW_BOX}>
        <Rect
          x={PHONE.x}
          y={PHONE.y}
          width={PHONE.w}
          height={PHONE.h}
          rx={PHONE.r}
          fill="none"
          stroke={colors.border}
          strokeWidth={2}
        />
        <Rect
          x={SPEAKER.x}
          y={SPEAKER.y}
          width={SPEAKER.w}
          height={SPEAKER.h}
          rx={SPEAKER.r}
          fill={colors.border}
        />

        {SPEED_LINES.map(line => (
          <Path
            key={line.y}
            d={`M${line.x1} ${line.y} H${line.x2}`}
            stroke={colors.brandAccent}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ))}

        <Rect
          x={TILE.x}
          y={TILE.y}
          width={TILE.w}
          height={TILE.h}
          rx={TILE.r}
          fill={colors.brandAccent}
        />

        <Svg
          x={TILE.x + 10}
          y={TILE.y + 10}
          width={TILE.w - 20}
          height={TILE.h - 20}
          viewBox="0 0 24 24"
        >
          <Path d={SHIELD} fill={colors.primaryForeground} />
          <Path
            d={TICK}
            fill="none"
            stroke={colors.brandAccent}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Svg>
    </View>
  );
});

VerificationHeroArt.displayName = 'VerificationHeroArt';
