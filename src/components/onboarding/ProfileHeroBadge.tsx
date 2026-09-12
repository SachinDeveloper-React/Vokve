import React, { memo } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';

const SIZE = moderateScale(104);
const VIEW_BOX = '0 0 104 104';

const RING = { cx: 52, cy: 52, r: 44 };
const HEAD = { cx: 52, cy: 42, r: 13 };
/** The shoulders, drawn as a rounded bar rather than an arc. */
const BODY = { x: 36, y: 62, w: 32, h: 10, r: 3 };

interface Props {
  style?: StyleProp<ViewStyle>;
}

/**
 * The empty-avatar mark above "Complete Your Profile".
 *
 * A ring with a placeholder figure rather than a real `Avatar`: at this point
 * there is no name to derive initials from and no photo to show, and an
 * `Avatar` falling back to "?" reads as an error rather than as an invitation.
 * Drawn in the brand accent so it stands in for the picture the profile does
 * not have yet.
 */
export const ProfileHeroBadge = memo(({ style }: Props) => {
  const { colors } = useTheme();

  return (
    <View
      style={style}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={SIZE} height={SIZE} viewBox={VIEW_BOX}>
        <Circle
          cx={RING.cx}
          cy={RING.cy}
          r={RING.r}
          fill="none"
          stroke={colors.brandAccent}
          strokeWidth={2}
        />
        <Circle
          cx={HEAD.cx}
          cy={HEAD.cy}
          r={HEAD.r}
          fill="none"
          stroke={colors.brandAccent}
          strokeWidth={2.5}
        />
        <Rect
          x={BODY.x}
          y={BODY.y}
          width={BODY.w}
          height={BODY.h}
          rx={BODY.r}
          fill="none"
          stroke={colors.brandAccent}
          strokeWidth={2.5}
        />
        {/* Closes the gap between head and shoulders on the ring's inner edge. */}
        <Path
          d={`M${BODY.x} ${BODY.y} H${BODY.x + BODY.w}`}
          stroke={colors.brandAccent}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
});

ProfileHeroBadge.displayName = 'ProfileHeroBadge';
