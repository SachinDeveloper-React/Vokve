import React, { memo, useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from './AppText';
import { Pressable } from '../form/Pressable';

/** Wide enough for two digits and its own padding. */
const BADGE_SIZE = moderateScale(20);

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  /** Shown in the chip's badge. Left out, the chip is a label on its own. */
  count?: number;
  icon?: LucideIcon;
}

interface ChipProps {
  value: string;
  label: string;
  count?: number;
  icon?: LucideIcon;
  selected: boolean;
  onPress: (value: string) => void;
}

/**
 * One chip. Typed on plain strings rather than the row's generic: `memo` on a
 * generic component erases the generic, and the row casts back on the way out.
 */
const FilterChip = memo(
  ({ value, label, count, icon, selected, onPress }: ChipProps) => {
    const { colors } = useTheme();
    const press = useCallback(() => onPress(value), [onPress, value]);

    return (
      <Pressable
        onPress={press}
        feedback="opacity"
        visualSize={32}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      >
        <HStack
          align="center"
          gap="sm"
          px="md"
          py="sm"
          style={[styles.chip, selected && { backgroundColor: colors.text }]}
        >
          {icon ? (
            <Icon
              as={icon}
              size="sm"
              tint={selected ? colors.card : colors.textSecondary}
            />
          ) : null}

          <AppText
            variant="micro"
            style={[
              styles.label,
              { color: selected ? colors.card : colors.text },
            ]}
          >
            {label}
          </AppText>

          {count === undefined ? null : (
            <View
              // The number is already in the chip's accessibility label; read
              // out again here it would announce as a stray digit.
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.badge,
                {
                  backgroundColor: selected ? colors.brandAccent : colors.muted,
                },
              ]}
            >
              <AppText
                variant="miniMicro"
                style={[
                  styles.badgeText,
                  {
                    color: selected
                      ? colors.primaryForeground
                      : colors.textSecondary,
                  },
                ]}
              >
                {count}
              </AppText>
            </View>
          )}
        </HStack>
      </Pressable>
    );
  },
);

FilterChip.displayName = 'FilterChip';

interface Props<T extends string> {
  options: readonly FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A scrolling row of chips that pick one of a closed set.
 *
 * The same inverting chip the notification centre uses, generalised: the
 * chosen one takes the app's text colour as its background rather than a
 * tint, which reads at a glance in both themes where a wash subtle enough not
 * to shout is rarely strong enough to see.
 *
 * It scrolls rather than dividing the width evenly. A row that fitted its
 * chips to the screen would have to be rebuilt the first time a fifth filter
 * was added, and a count badge is exactly the kind of thing that pushes a
 * four-across row over its budget.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: Props<T>) {
  const press = useCallback(
    (next: string) => onChange(next as T),
    [onChange],
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {options.map(option => (
        <FilterChip
          key={option.value}
          value={option.value}
          label={option.label}
          count={option.count}
          icon={option.icon}
          selected={option.value === value}
          onPress={press}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs, alignItems: 'center' },
  chip: { borderRadius: radius.pill },
  label: { fontWeight: '600' },
  badge: {
    minWidth: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontWeight: '700' },
});
