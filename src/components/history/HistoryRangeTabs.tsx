import React, { memo, useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { radius, spacing, useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

/** How much of the diary is being looked at. */
export type HistoryRange = 'daily' | 'weekly' | 'monthly' | 'custom';

const RANGES: readonly { value: HistoryRange; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
];

interface TabProps {
  value: HistoryRange;
  label: string;
  selected: boolean;
  onPress: (value: HistoryRange) => void;
}

const RangeTab = memo(({ value, label, selected, onPress }: TabProps) => {
  const { colors } = useTheme();
  const press = useCallback(() => onPress(value), [onPress, value]);

  return (
    <Pressable
      onPress={press}
      feedback="opacity"
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <HStack
        align="center"
        justify="center"
        px="base"
        py="sm"
        style={[
          styles.tab,
          { backgroundColor: selected ? colors.primary : colors.muted },
        ]}
      >
        <AppText
          variant="micro"
          numberOfLines={1}
          style={[
            styles.label,
            {
              color: selected ? colors.primaryForeground : colors.textSecondary,
            },
          ]}
        >
          {label}
        </AppText>
      </HStack>
    </Pressable>
  );
});

RangeTab.displayName = 'RangeTab';

interface Props {
  value: HistoryRange;
  onChange: (value: HistoryRange) => void;
}

/**
 * Daily, weekly, monthly, or a span the user picks.
 *
 * "Custom" earns its place here rather than being a date picker tucked into
 * the day pager: a question like "how did I eat over the holidays" has no
 * answer in fixed windows, and it is the one range nobody can guess for the
 * user.
 */
export const HistoryRangeTabs = memo(({ value, onChange }: Props) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.row}
    accessibilityRole="tablist"
  >
    {RANGES.map(range => (
      <RangeTab
        key={range.value}
        value={range.value}
        label={range.label}
        selected={range.value === value}
        onPress={onChange}
      />
    ))}
  </ScrollView>
));

HistoryRangeTabs.displayName = 'HistoryRangeTabs';

const styles = StyleSheet.create({
  row: { gap: spacing.sm },
  tab: { borderRadius: radius.md, minWidth: 84 },
  label: { fontWeight: '600' },
});
