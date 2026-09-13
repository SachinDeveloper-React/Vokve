import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { radius, useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';

export interface Macros {
  carbsG: number;
  proteinG: number;
  fatsG: number;
  fiberG: number;
}

/** Grams as a food label writes them — 3 rather than 3.0, 0.3 rather than 0. */
function grams(value: number): string {
  return Number.isInteger(value) ? `${value}g` : `${value.toFixed(1)}g`;
}

interface Props {
  macros: Macros;
  /** `plain` drops the tray behind the figures, for use inside a summary. */
  variant?: 'tray' | 'plain';
}

/**
 * The four macro figures of a food or a meal, in one line.
 *
 * Always the same four in the same order, whether they belong to one banana or
 * to the whole meal: the row under a food and the row in the summary are read
 * against each other, and a different order in each would make that a puzzle.
 */
export const MacroStrip = memo(({ macros, variant = 'tray' }: Props) => {
  const { colors } = useTheme();

  const figures = [
    `Carbs ${grams(macros.carbsG)}`,
    `Protein ${grams(macros.proteinG)}`,
    `Fat ${grams(macros.fatsG)}`,
    `Fiber ${grams(macros.fiberG)}`,
  ];

  return (
    <HStack
      align="center"
      gap="md"
      wrap
      px={variant === 'tray' ? 'md' : 'none'}
      py={variant === 'tray' ? 'sm' : 'none'}
      style={
        variant === 'tray'
          ? [styles.tray, { backgroundColor: colors.muted }]
          : undefined
      }
      accessible
      accessibilityLabel={figures.join(', ')}
    >
      {figures.map(figure => (
        <AppText
          key={figure}
          variant="miniMicro"
          color="textSecondary"
          numberOfLines={1}
        >
          {figure}
        </AppText>
      ))}
    </HStack>
  );
});

MacroStrip.displayName = 'MacroStrip';

const styles = StyleSheet.create({
  tray: { borderRadius: radius.md },
});
