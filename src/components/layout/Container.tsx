import React, { memo } from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { useResponsive } from '../../hooks/useResponsive';
import { spacing } from '../../theme';
import type { SpacingToken } from './Box';

export type ContainerWidth = 'sm' | 'md' | 'lg' | 'full';

/** Caps in logical points, chosen for line length rather than device sizes. */
const MAX_WIDTHS: Record<Exclude<ContainerWidth, 'full'>, number> = {
  sm: 420,
  md: 640,
  lg: 840,
};

interface Props extends ViewProps {
  children: React.ReactNode;
  size?: ContainerWidth;
  /** Horizontal padding. Pass 'none' for a full-bleed child such as a chart. */
  gutter?: SpacingToken;
}

/**
 * Constrains content to a readable column and centres it once the screen is
 * wider than the cap.
 *
 * `Screen` already does this for a whole screen; `Container` is for the cases
 * a screen cannot cover — a section inside a ScrollView, a form on a modal, or
 * one narrow block on an otherwise full-bleed page.
 */
export const Container = memo(
  ({ children, size = 'md', gutter = 'base', style, ...rest }: Props) => {
    const { width } = useResponsive();
    const maxWidth = size === 'full' ? undefined : MAX_WIDTHS[size];
    const shouldCentre = maxWidth !== undefined && width > maxWidth;

    return (
      <View
        style={[
          styles.base,
          { paddingHorizontal: spacing[gutter] },
          maxWidth !== undefined && { maxWidth },
          shouldCentre && styles.centred,
          style,
        ]}
        {...rest}
      >
        {children}
      </View>
    );
  },
);

Container.displayName = 'Container';

const styles = StyleSheet.create({
  base: { width: '100%' },
  centred: { alignSelf: 'center' },
});
