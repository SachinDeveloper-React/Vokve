import React, { memo, useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { radius, spacing, useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

/** Which view of the plan is showing. */
export type DietPlanTab = 'today' | 'plan' | 'nutrition' | 'history';

const TABS: readonly { value: DietPlanTab; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'plan', label: 'Plan' },
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'history', label: 'History' },
];

interface TabProps {
  value: DietPlanTab;
  label: string;
  selected: boolean;
  onPress: (value: DietPlanTab) => void;
}

const TabButton = memo(({ value, label, selected, onPress }: TabProps) => {
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
          selected
            ? { backgroundColor: colors.primary }
            : { backgroundColor: colors.muted },
        ]}
      >
        <AppText
          variant="micro"
          numberOfLines={1}
          style={[
            styles.label,
            { color: selected ? colors.primaryForeground : colors.textSecondary },
          ]}
        >
          {label}
        </AppText>
      </HStack>
    </Pressable>
  );
});

TabButton.displayName = 'TabButton';

interface Props {
  value: DietPlanTab;
  onChange: (value: DietPlanTab) => void;
}

/**
 * The four views of the plan.
 *
 * Filled pills rather than an underlined tab bar: the screen is already inside
 * the app's own tab bar, and a second underlined row would read as two
 * navigations of the same kind stacked on each other.
 *
 * The row scrolls because four words do not fit across a small phone, and
 * clipping "History" would hide the one view that answers "did I stick to it".
 */
export const DietPlanTabs = memo(({ value, onChange }: Props) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.row}
    accessibilityRole="tablist"
  >
    {TABS.map(tab => (
      <TabButton
        key={tab.value}
        value={tab.value}
        label={tab.label}
        selected={tab.value === value}
        onPress={onChange}
      />
    ))}
  </ScrollView>
));

DietPlanTabs.displayName = 'DietPlanTabs';

const styles = StyleSheet.create({
  row: { gap: spacing.sm },
  tab: { borderRadius: radius.md, minWidth: 80 },
  label: { fontWeight: '600' },
});
