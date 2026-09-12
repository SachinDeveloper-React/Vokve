import React, { memo, useMemo } from 'react';
import { View, ViewStyle } from 'react-native';
import { useResponsive, type Breakpoint } from '../../hooks/useResponsive';
import { spacing } from '../../theme';
import type { SpacingToken } from './Box';

interface Props {
  children: React.ReactNode;
  /**
   * Number of equal columns — either fixed, or per breakpoint:
   * `columns={{ compact: 2, expanded: 4 }}`.
   */
  columns?: number | Partial<Record<Breakpoint, number>>;
  gap?: SpacingToken;
  style?: ViewStyle;
}

/**
 * An equal-column grid.
 *
 * Spacing is done with gutters — half the gap as padding inside each cell,
 * pulled back by a negative margin on the container — rather than flex `gap`.
 * A percentage width plus a flex gap overflows the row (100% + gap > 100%) and
 * silently collapses the grid to one column per row; gutters stay exact at any
 * column count without having to measure the container first.
 *
 * Layout only. For long, scrolling collections use FlashList, which recycles
 * rows instead of mounting every cell at once.
 */
export const Grid = memo(
  ({ children, columns = 2, gap = 'md', style }: Props) => {
    const { select } = useResponsive();
    const gapValue = spacing[gap];

    // Falls back to 2 only if a responsive map defines nothing at or below
    // the current breakpoint.
    const columnCount =
      typeof columns === 'number' ? columns : select(columns) ?? 2;

    const containerStyle = useMemo<ViewStyle>(
      () => ({
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -gapValue / 2,
        marginBottom: -gapValue,
      }),
      [gapValue],
    );

    const cellStyle = useMemo<ViewStyle>(
      () => ({
        width: `${100 / columnCount}%`,
        paddingHorizontal: gapValue / 2,
        paddingBottom: gapValue,
      }),
      [columnCount, gapValue],
    );

    const items = React.Children.toArray(children);

    return (
      <View style={[containerStyle, style]}>
        {items.map((child, index) => (
          <View key={index} style={cellStyle}>
            {child}
          </View>
        ))}
      </View>
    );
  },
);

Grid.displayName = 'Grid';
