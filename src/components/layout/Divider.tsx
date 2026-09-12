import React, { memo, useMemo } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { spacing, useTheme } from '../../theme';
import type { SpacingToken } from './Box';

interface Props {
  orientation?: 'horizontal' | 'vertical';
  /** Space added on both sides of the rule, along its cross axis. */
  inset?: SpacingToken;
  /** Indents the start of the rule — used for list separators under an avatar. */
  indent?: number;
  /**
   * Overrides the theme's border colour. Only for a rule drawn on a surface
   * that is not the theme's — inside the profile panel, where the border token
   * is a light-mode grey that would disappear against the dark gradient.
   */
  tint?: string;
}

/**
 * A hairline rule. `StyleSheet.hairlineWidth` renders the thinnest line the
 * screen can actually draw, which is what keeps separators looking crisp
 * rather than heavy on high-density displays.
 */
export const Divider = memo(
  ({ orientation = 'horizontal', inset, indent, tint }: Props) => {
    const { colors } = useTheme();
    const isHorizontal = orientation === 'horizontal';

    const style = useMemo<ViewStyle>(
      () => ({
        backgroundColor: tint ?? colors.border,
        ...(isHorizontal
          ? {
              height: StyleSheet.hairlineWidth,
              alignSelf: 'stretch',
              ...(inset !== undefined && { marginVertical: spacing[inset] }),
              ...(indent !== undefined && { marginLeft: indent }),
            }
          : {
              width: StyleSheet.hairlineWidth,
              alignSelf: 'stretch',
              ...(inset !== undefined && { marginHorizontal: spacing[inset] }),
            }),
      }),
      [colors.border, tint, isHorizontal, inset, indent],
    );

    return <View style={style} accessibilityRole="none" />;
  },
);

Divider.displayName = 'Divider';
