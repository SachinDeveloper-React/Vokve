import React, { memo, useMemo } from 'react';
import { StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import type { ThemeColors } from '../../constants/colors';
import { radius as radiusTokens, spacing, useTheme } from '../../theme';

export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radiusTokens;

/** Colour tokens that are flat strings and read as a surface. */
export type SurfaceToken = Extract<
  keyof ThemeColors,
  | 'background'
  | 'card'
  | 'popover'
  | 'muted'
  | 'secondary'
  | 'accent'
  | 'primary'
  | 'destructive'
  | 'success'
  | 'warning'
  | 'inputBackground'
>;

export interface BoxProps extends ViewProps {
  /** Padding — `p` is all sides, `px`/`py` are axes, the rest are single edges. */
  p?: SpacingToken;
  px?: SpacingToken;
  py?: SpacingToken;
  pt?: SpacingToken;
  pb?: SpacingToken;
  pl?: SpacingToken;
  pr?: SpacingToken;
  m?: SpacingToken;
  mx?: SpacingToken;
  my?: SpacingToken;
  mt?: SpacingToken;
  mb?: SpacingToken;
  bg?: SurfaceToken;
  radius?: RadiusToken;
  /** Draws a hairline border in the theme's border colour. */
  bordered?: boolean;
  flex?: number;
}

/**
 * The layout primitive every other layout component builds on. Taking spacing
 * as token names rather than numbers is the point: `p="base"` cannot drift to
 * 15 or 17 the way a raw `padding: 16` does across a growing codebase.
 */
export const Box = memo(
  ({
    p,
    px,
    py,
    pt,
    pb,
    pl,
    pr,
    m,
    mx,
    my,
    mt,
    mb,
    bg,
    radius,
    bordered = false,
    flex,
    style,
    ...rest
  }: BoxProps) => {
    const { colors } = useTheme();

    // Built as a literal rather than by mutation: RN 0.87 types ViewStyle's
    // properties as readonly.
    const computed = useMemo<ViewStyle>(
      () => ({
        ...(p !== undefined && { padding: spacing[p] }),
        ...(px !== undefined && { paddingHorizontal: spacing[px] }),
        ...(py !== undefined && { paddingVertical: spacing[py] }),
        ...(pt !== undefined && { paddingTop: spacing[pt] }),
        ...(pb !== undefined && { paddingBottom: spacing[pb] }),
        ...(pl !== undefined && { paddingLeft: spacing[pl] }),
        ...(pr !== undefined && { paddingRight: spacing[pr] }),
        ...(m !== undefined && { margin: spacing[m] }),
        ...(mx !== undefined && { marginHorizontal: spacing[mx] }),
        ...(my !== undefined && { marginVertical: spacing[my] }),
        ...(mt !== undefined && { marginTop: spacing[mt] }),
        ...(mb !== undefined && { marginBottom: spacing[mb] }),
        ...(bg !== undefined && { backgroundColor: colors[bg] }),
        ...(radius !== undefined && { borderRadius: radiusTokens[radius] }),
        ...(flex !== undefined && { flex }),
        ...(bordered && {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        }),
      }),
      [
        p, px, py, pt, pb, pl, pr,
        m, mx, my, mt, mb,
        bg, radius, bordered, flex, colors,
      ],
    );

    return <View style={[computed, style]} {...rest} />;
  },
);

Box.displayName = 'Box';
