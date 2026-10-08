import React, { memo, useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { ORDER_FILTERS } from '../../stores/ordersStore';
import type { OrderFilter } from '../../types/models';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface TabProps {
  value: OrderFilter;
  label: string;
  selected: boolean;
  onPress: (value: OrderFilter) => void;
}

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    row: { gap: spacing.lg, paddingHorizontal: spacing.xxs },
    // The rule the chosen tab is underlined against, and the rest sit on.
    rule: { height: 1, backgroundColor: colors.border },
    tab: { paddingBottom: spacing.sm },
    mark: {
      height: 2,
      borderRadius: radius.pill,
      backgroundColor: colors.brandAccent,
      alignSelf: 'stretch',
    },
    label: { fontWeight: '600' },
    /** An unchosen tab keeps the mark's height and gives up its colour. */
    unmarked: { backgroundColor: 'transparent' },
  });

const FilterTab = memo(({ value, label, selected, onPress }: TabProps) => {
  const styles = useThemedStyles(makeStyles);
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
      <VStack gap="sm" align="center" style={styles.tab}>
        <AppText
          variant="caption"
          numberOfLines={1}
          style={[
            styles.label,
            { color: selected ? colors.brandAccent : colors.textSecondary },
          ]}
        >
          {label}
        </AppText>
        {/* The mark is drawn either way and only coloured in, so a tab does
            not jump by two points as it is chosen. */}
        <View style={[styles.mark, !selected && styles.unmarked]} />
      </VStack>
    </Pressable>
  );
});

FilterTab.displayName = 'FilterTab';

interface Props {
  value: OrderFilter;
  onChange: (value: OrderFilter) => void;
}

/**
 * Which orders the list is showing: all of them, or one stage of the
 * journey (RULES R5).
 *
 * Underlined rather than filled, unlike the app's other tab rows, because
 * these sit directly over a list they filter rather than switching the
 * whole page — the rule carries the eye from the chosen word down into the
 * orders it is now showing. They scroll: five tabs do not fit a narrow
 * phone without shrinking the words past reading.
 */
export const OrderFilterTabs = memo(({ value, onChange }: Props) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityRole="tablist"
      >
        {ORDER_FILTERS.map(filter => (
          <FilterTab
            key={filter.value}
            value={filter.value}
            label={filter.label}
            selected={filter.value === value}
            onPress={onChange}
          />
        ))}
      </ScrollView>
      <View style={styles.rule} />
    </View>
  );
});

OrderFilterTabs.displayName = 'OrderFilterTabs';
