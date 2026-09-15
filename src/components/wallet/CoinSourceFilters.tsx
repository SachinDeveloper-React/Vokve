import React, { memo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { LayoutGrid, type LucideIcon } from 'lucide-react-native';
import { spacing } from '../../theme';
import { coinSourceSchema, type CoinSource } from '../../types/models';
import { Card } from '../ui/Card';
import { COIN_SOURCE_STYLE } from './CoinTransactionRow';
import {
  CoinSourceFilterChip,
  type CoinSourceFilter,
} from './CoinSourceFilterChip';

/**
 * How each source reads on a chip. Plural where the row's title is singular —
 * a chip stands for every workout, not one — and the label is the only place
 * the two may differ; the glyph comes from the row's own map.
 */
const SOURCE_LABEL: Record<CoinSource, string> = {
  steps: 'Steps',
  workout: 'Workouts',
  streak: 'Streaks',
  challenge: 'Challenges',
  referral: 'Referrals',
  purchase: 'Purchases',
  refund: 'Refunds',
};

interface FilterDefinition {
  value: CoinSourceFilter;
  label: string;
  icon: LucideIcon;
}

/**
 * "All" first, then the sources in the order the schema declares them — which
 * runs earned before spent, so the chips a user is most likely to want sit
 * nearest the left edge.
 */
const FILTERS: readonly FilterDefinition[] = [
  { value: null, label: 'All', icon: LayoutGrid },
  ...coinSourceSchema.options.map(source => ({
    value: source,
    label: SOURCE_LABEL[source],
    icon: COIN_SOURCE_STYLE[source].icon,
  })),
];

interface Props {
  value: CoinSourceFilter;
  onChange: (value: CoinSourceFilter) => void;
}

/**
 * The coin history's filter row, on its own card.
 *
 * Eight chips cannot fit across a phone, so the row scrolls — the same shape
 * as the notification centre's, which is what makes it read as a filter
 * rather than as a second set of tabs.
 */
export const CoinSourceFilters = memo(({ value, onChange }: Props) => (
  <Card radius="xl" padding="md">
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {FILTERS.map(filter => (
        <CoinSourceFilterChip
          key={filter.value ?? 'all'}
          value={filter.value}
          label={filter.label}
          icon={filter.icon}
          selected={filter.value === value}
          onPress={onChange}
        />
      ))}
    </ScrollView>
  </Card>
));

CoinSourceFilters.displayName = 'CoinSourceFilters';

const styles = StyleSheet.create({
  row: { gap: spacing.xs, alignItems: 'center' },
});
