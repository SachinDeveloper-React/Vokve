import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useThemedStyles, type ThemeShape } from '../../theme';
import type { WorkoutTemplate } from '../../types/models';
import { AppText } from '../ui/AppText';

interface Props {
  template: WorkoutTemplate;
  onPress: (template: WorkoutTemplate) => void;
}

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.base,
      gap: spacing.xs,
    },
    pressed: { opacity: 0.7 },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    dot: {
      width: 3,
      height: 3,
      borderRadius: 2,
      backgroundColor: colors.textTertiary,
    },
  });

/**
 * Memoised and given a stable `onPress` by the parent, so scrolling a long
 * template list does not re-render every row on each frame.
 */
export const WorkoutCard = memo(({ template, onPress }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const handlePress = useCallback(() => onPress(template), [onPress, template]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${template.title}, ${template.estimatedMinutes} minutes`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <AppText variant="h3">{template.title}</AppText>
      <AppText variant="caption" color="textSecondary" numberOfLines={2}>
        {template.description}
      </AppText>
      <View style={styles.footer}>
        <AppText variant="label" color="textTertiary">
          {template.estimatedMinutes} min
        </AppText>
        <View style={styles.dot} />
        <AppText variant="label" color="textTertiary">
          {template.exercises.length} exercises
        </AppText>
      </View>
    </Pressable>
  );
});

WorkoutCard.displayName = 'WorkoutCard';
