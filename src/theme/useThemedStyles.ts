import { useMemo } from 'react';
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import type { ThemeColors } from '../constants/colors';
import { useTheme } from './ThemeContext';
import { elevation, radius, spacing, typography } from './tokens';

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

export interface ThemeShape {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  elevation: typeof elevation;
}

/**
 * Builds a StyleSheet from the active theme and caches it per colour scheme.
 *
 * Styles are the most common source of avoidable re-renders: an inline object
 * is a new identity on every render, so every child that receives it re-renders
 * too. Passing a module-scope factory here means the sheet is created once per
 * scheme and reused for the life of the app.
 *
 *     const styles = useThemedStyles(makeStyles);
 *
 *     const makeStyles = ({ colors, spacing }: ThemeShape) =>
 *       StyleSheet.create({ card: { backgroundColor: colors.card, padding: spacing.base } });
 */
export function useThemedStyles<T extends NamedStyles>(
  factory: (theme: ThemeShape) => T,
): T {
  const { colors, scheme } = useTheme();

  return useMemo(
    () =>
      StyleSheet.create(
        factory({ colors, spacing, radius, typography, elevation }),
      ),
    // `colors` is a module constant per scheme, so `scheme` fully describes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheme, factory],
  );
}
