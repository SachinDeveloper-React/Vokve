import React, { memo, useMemo } from 'react';
import { View, ViewStyle } from 'react-native';
import { spacing } from '../../theme';
import { Box, type BoxProps, type SpacingToken } from './Box';

type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

export interface StackProps extends BoxProps {
  /** Space between children, from the spacing scale. */
  gap?: SpacingToken;
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
  /** Reverses the visual order without reordering the children in code. */
  reverse?: boolean;
}

const ALIGN: Record<Align, ViewStyle['alignItems']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

const JUSTIFY: Record<Justify, ViewStyle['justifyContent']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};

interface InternalProps extends StackProps {
  direction: 'row' | 'column';
}

const Stack = memo(
  ({
    direction,
    gap,
    align,
    justify,
    wrap,
    reverse,
    style,
    ...boxProps
  }: InternalProps) => {
    const stackStyle = useMemo<ViewStyle>(
      () => ({
        flexDirection: reverse ? `${direction}-reverse` : direction,
        ...(gap !== undefined && { gap: spacing[gap] }),
        ...(align !== undefined && { alignItems: ALIGN[align] }),
        ...(justify !== undefined && { justifyContent: JUSTIFY[justify] }),
        ...(wrap && { flexWrap: 'wrap' as const }),
      }),
      [direction, gap, align, justify, wrap, reverse],
    );

    return <Box style={[stackStyle, style]} {...boxProps} />;
  },
);

Stack.displayName = 'Stack';

/**
 * Horizontal stack. `gap` is a real flex gap rather than margins on children,
 * so a conditionally rendered child cannot leave an orphaned space behind.
 */
export const HStack = memo((props: StackProps) => (
  <Stack direction="row" {...props} />
));

HStack.displayName = 'HStack';

/** Vertical stack. Same rules as HStack, stacked down the screen. */
export const VStack = memo((props: StackProps) => (
  <Stack direction="column" {...props} />
));

VStack.displayName = 'VStack';

/** Fills its parent and centres its children on both axes. */
export const Center = memo(({ style, ...props }: BoxProps) => (
  <Box style={[centerStyle, style]} {...props} />
));

Center.displayName = 'Center';

/** Pushes siblings apart inside a stack. */
export const Spacer = memo(() => <View style={spacerStyle} />);

Spacer.displayName = 'Spacer';

const centerStyle: ViewStyle = {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
};

const spacerStyle: ViewStyle = { flex: 1 };
