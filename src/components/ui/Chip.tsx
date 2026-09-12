import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing, typography, useTheme } from '../../theme';

interface Props {
  label: string;
  /** Text colour. The pill behind it is a faded wash of this. */
  tint?: string;
}

/**
 * A small tinted pill for a secondary figure — a percentage, a count, a tag.
 *
 * Like IconBadge, the background is derived from the tint rather than being a
 * second token to keep in step with it.
 */
export const Chip = memo(({ label, tint }: Props) => {
  const { colors, isDark } = useTheme();
  const color = tint ?? colors.primary;

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: withAlpha(color, isDark ? 0.22 : 0.12) },
      ]}
    >
      <Text style={[styles.text, { color }]} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </View>
  );
});

Chip.displayName = 'Chip';

function withAlpha(color: string, alpha: number): string {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return color;
  const [r, g, b] = match[1].split(',').map(part => part.trim());
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: { ...typography.micro, fontWeight: '600' },
});
