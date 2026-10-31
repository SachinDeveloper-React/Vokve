import React, { memo, useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { LayoutGrid, type LucideIcon } from 'lucide-react-native';
import { spacing } from '../../theme';
import type { CoinSource } from '../../types/models';
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

interface Props {
  /**
   * The sources to offer, in the server's order (⚙ `coins.historyFilters`).
   *
   * Empty draws nothing at all. The row used to be built here from the whole
   * `CoinSource` enum, which meant taking a chip off was a release — and
   * guessing the row back from the enum while the first sync is in flight
   * would put that same row on screen for a beat and then change it.
   */
  sources: readonly CoinSource[];
  value: CoinSourceFilter;
  onChange: (value: CoinSourceFilter) => void;
}

/**
 * The coin history's filter row, on its own card.
 *
 * Which sources are offered is the operator's (⚙ `coins.historyFilters`);
 * what each one is called and the glyph beside it are the app's, because they
 * are the same label and glyph the ledger rows use and two sources for those
 * would have a chip and the rows under it disagree.
 *
 * The filtering is the server's either way: the screen sends `?source=` and
 * the server answers, so a source that is not on the row is not hidden — its
 * coins still show under "All", it simply has no chip.
 *
 * More chips than fit across a phone, so the row scrolls — the same shape as
 * the notification centre's, which is what makes it read as a filter rather
 * than as a second set of tabs.
 */
export const CoinSourceFilters = memo(({ sources, value, onChange }: Props) => {
  const filters = useMemo<FilterDefinition[]>(
    () =>
      sources.length === 0
        ? []
        : [
            { value: null, label: 'All', icon: LayoutGrid },
            ...sources.map(source => ({
              value: source,
              label: SOURCE_LABEL[source],
              icon: COIN_SOURCE_STYLE[source].icon,
            })),
          ],
    [sources],
  );

  if (filters.length === 0) return null;

  return (
    <Card radius="xl" padding="md">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {filters.map(filter => (
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
  );
});

CoinSourceFilters.displayName = 'CoinSourceFilters';

const styles = StyleSheet.create({
  row: { gap: spacing.xs, alignItems: 'center' },
});
