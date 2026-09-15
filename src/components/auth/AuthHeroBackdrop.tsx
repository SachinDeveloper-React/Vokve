import React, { memo } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, {
  Defs,
  G,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';

const WIDTH = moderateScale(196);
const HEIGHT = moderateScale(224);

const VIEW_BOX = '0 0 196 224';

const GLOW_CX = 104;
const GLOW_CY = 112;

const GLOW_RADIUS = 58;

const FIGURE_W = 87;
const FIGURE_H = 139;

const FIGURE_SCALE = 0.8;

const FIGURE_ANCHOR_X = 0.46;
const FIGURE_ANCHOR_Y = 0.72;

const FIGURE_ZOOM = (GLOW_RADIUS * 2 * FIGURE_SCALE) / FIGURE_H;
const FIGURE_X = GLOW_CX - FIGURE_W * FIGURE_ZOOM * FIGURE_ANCHOR_X;
const FIGURE_Y = GLOW_CY - FIGURE_H * FIGURE_ZOOM * FIGURE_ANCHOR_Y;
const FIGURE_TRANSFORM = `translate(${FIGURE_X} ${FIGURE_Y}) scale(${FIGURE_ZOOM})`;
const SHADE_CX = FIGURE_W * FIGURE_ANCHOR_X;
const SHADE_CY = FIGURE_H * FIGURE_ANCHOR_Y;
const SHADE_RADIUS = (GLOW_RADIUS * 0.75) / FIGURE_ZOOM;

/** Traced in figure units, so it scales with the body instead of thickening. */
const RIM_WIDTH = 0.9;

const FIGURE_PATH =
  'M39.758 0.685281C52.1803 4.67991 57.9136 18.6611 54.0914 31.6436C49.3136 45.6248 40.7136 53.6141 36.8914 67.5953L52.1803 99.5523L86.5803 126.516L78.9358 138.5L42.6247 117.528L23.5136 91.5631L13.0025 125.517L0.580261 123.52L9.18026 74.5859L22.558 46.6235C11.0914 35.6383 11.0914 20.6584 17.7803 10.6719C23.5136 2.6826 31.158 -0.313376 39.758 0.685281Z';

interface Props {
  style?: StyleProp<ViewStyle>;
}
export const AuthHeroBackdrop = memo(({ style }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <View
      style={style}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={WIDTH} height={HEIGHT} viewBox={VIEW_BOX}>
        <Defs>
          <RadialGradient
            id="authGlow"
            gradientUnits="userSpaceOnUse"
            cx={GLOW_CX}
            cy={GLOW_CY}
            r={GLOW_RADIUS}
          >
            <Stop
              offset="0"
              stopColor={colors.brandAccent}
              stopOpacity={isDark ? 0.55 : 0.34}
            />
            <Stop
              offset="0.4"
              stopColor={colors.brandAccent}
              stopOpacity={isDark ? 0.24 : 0.15}
            />
            <Stop
              offset="0.68"
              stopColor={colors.brandAccent}
              stopOpacity={isDark ? 0.09 : 0.06}
            />
            <Stop offset="1" stopColor={colors.brandAccent} stopOpacity={0} />
          </RadialGradient>

          <RadialGradient
            id="authFigure"
            gradientUnits="userSpaceOnUse"
            cx={SHADE_CX}
            cy={SHADE_CY}
            r={SHADE_RADIUS}
          >
            <Stop
              offset="0"
              stopColor={colors.background}
              stopOpacity={isDark ? 0.78 : 0.86}
            />
            <Stop
              offset="0.5"
              stopColor={colors.background}
              stopOpacity={isDark ? 0.92 : 0.95}
            />
            <Stop offset="1" stopColor={colors.background} stopOpacity={1} />
          </RadialGradient>

          <RadialGradient
            id="authRim"
            gradientUnits="userSpaceOnUse"
            cx={SHADE_CX}
            cy={SHADE_CY}
            r={SHADE_RADIUS}
          >
            <Stop
              offset="0"
              stopColor={colors.brandAccent}
              stopOpacity={isDark ? 0.36 : 0.24}
            />
            <Stop
              offset="0.55"
              stopColor={colors.brandAccent}
              stopOpacity={isDark ? 0.14 : 0.09}
            />
            <Stop offset="1" stopColor={colors.brandAccent} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Rect x="0" y="0" width="196" height="224" fill="url(#authGlow)" />

        <G transform={FIGURE_TRANSFORM}>
          <Path
            d={FIGURE_PATH}
            fill="url(#authFigure)"
            stroke="url(#authRim)"
            strokeWidth={RIM_WIDTH}
          />
        </G>
      </Svg>
    </View>
  );
});

AuthHeroBackdrop.displayName = 'AuthHeroBackdrop';
