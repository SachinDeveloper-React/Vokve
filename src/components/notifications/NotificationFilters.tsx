import React, { memo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import {
  Footprints,
  LayoutGrid,
  Settings,
  Star,
  type LucideIcon,
} from 'lucide-react-native';
import { spacing } from '../../theme';
import type {
  NotificationCounts,
  NotificationFilter,
} from '../../stores/notificationsStore';
import { Card } from '../ui/Card';
import { NotificationFilterChip } from './NotificationFilterChip';

interface FilterDefinition {
  value: NotificationFilter;
  label: string;
  icon: LucideIcon;
}

/**
 * "Rewards" reads better on a chip than the category's own singular name, and
 * the label is the only place the two are allowed to differ — everything else
 * keys off `value`.
 */
const FILTERS: readonly FilterDefinition[] = [
  { value: 'all', label: 'All', icon: LayoutGrid },
  { value: 'activity', label: 'Activity', icon: Footprints },
  { value: 'reward', label: 'Rewards', icon: Star },
  { value: 'system', label: 'System', icon: Settings },
];

interface Props {
  value: NotificationFilter;
  counts: NotificationCounts;
  onChange: (value: NotificationFilter) => void;
}

/**
 * The notification centre's filter row, on its own card.
 *
 * It scrolls rather than fitting four chips across the width: each chip
 * carries a glyph, a word and a count, and squeezed into a quarter of a 375pt
 * card they would each be under 80pt — enough to break "Activity" in half.
 * Scrolling also leaves room for a fifth filter without a redesign.
 */
export const NotificationFilters = memo(({ value, counts, onChange }: Props) => (
  <Card radius="xl" padding="md">
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {FILTERS.map(filter => (
        <NotificationFilterChip
          key={filter.value}
          value={filter.value}
          label={filter.label}
          icon={filter.icon}
          count={counts[filter.value]}
          selected={filter.value === value}
          onPress={onChange}
        />
      ))}
    </ScrollView>
  </Card>
));

NotificationFilters.displayName = 'NotificationFilters';

const styles = StyleSheet.create({
  row: { gap: spacing.xs, alignItems: 'center' },
});
