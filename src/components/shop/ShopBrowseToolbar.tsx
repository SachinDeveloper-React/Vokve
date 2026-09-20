import React, { memo, useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import {
  ArrowUpDown,
  PackageCheck,
  SlidersHorizontal,
} from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import type { ShopSort } from '../../types/models';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

/** How each sort reads on the button and in the sheet. */
export const SORT_LABEL: Record<ShopSort, string> = {
  popular: 'Popular',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  newest: 'Newest',
  rating: 'Top rated',
};

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}

/**
 * A plain text chip — no glyph, because a subcategory ("Bottoms", "Rackets")
 * has no icon of its own and an invented one would say less than the word.
 * The chosen chip inverts, as the app's other chips do.
 */
const Chip = memo(
  ({ label, selected, onPress, accessibilityLabel }: ChipProps) => {
    const { colors } = useTheme();
    return (
      <Pressable
        onPress={onPress}
        feedback="opacity"
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={accessibilityLabel ?? label}
      >
        <HStack
          align="center"
          px="md"
          py="sm"
          style={[
            styles.chip,
            {
              backgroundColor: selected ? colors.text : colors.card,
              borderColor: selected ? colors.text : colors.border,
            },
          ]}
        >
          <AppText
            variant="micro"
            style={[
              styles.chipLabel,
              { color: selected ? colors.card : colors.text },
            ]}
          >
            {label}
          </AppText>
        </HStack>
      </Pressable>
    );
  },
);

Chip.displayName = 'ShopBrowseChip';

interface Props {
  /** The shelf's subcategories, in catalogue order. Empty hides the row. */
  subcategories: readonly { name: string; count: number }[];
  subcategory: string | null;
  onChangeSubcategory: (subcategory: string | null) => void;
  sort: ShopSort;
  onPressSort: () => void;
  inStockOnly: boolean;
  onToggleInStock: () => void;
  /** How many filters are set, for the button's count; the sheet is the screen's. */
  filterCount: number;
  onPressFilters: () => void;
}

/**
 * The controls over a catalogue page: what to narrow to, how to order it,
 * and whether to hide what cannot be redeemed today.
 *
 * Two rows only when there are subcategories to offer; a page of the whole
 * catalogue or of the deals has none, and an empty row would be a gap that
 * looks like something failed to load.
 */
export const ShopBrowseToolbar = memo(
  ({
    subcategories,
    subcategory,
    onChangeSubcategory,
    sort,
    onPressSort,
    inStockOnly,
    onToggleInStock,
    filterCount,
    onPressFilters,
  }: Props) => {
    const { colors } = useTheme();
    const clearSubcategory = useCallback(
      () => onChangeSubcategory(null),
      [onChangeSubcategory],
    );

    return (
      <>
        {subcategories.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            <Chip
              label="All"
              selected={subcategory === null}
              onPress={clearSubcategory}
            />
            {subcategories.map(entry => (
              <Chip
                key={entry.name}
                label={`${entry.name} · ${entry.count}`}
                accessibilityLabel={`${entry.name}, ${entry.count}`}
                selected={subcategory === entry.name}
                onPress={() => onChangeSubcategory(entry.name)}
              />
            ))}
          </ScrollView>
        ) : null}

        <HStack align="center" justify="between" gap="sm">
          <HStack align="center" gap="md">
            <Pressable
              onPress={onPressSort}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel={`Sort by, ${SORT_LABEL[sort]}`}
            >
              <HStack align="center" gap="xs">
                <Icon as={ArrowUpDown} size="sm" tint={colors.primary} />
                <AppText variant="micro" color="primary">
                  {SORT_LABEL[sort]}
                </AppText>
              </HStack>
            </Pressable>

            <Pressable
              onPress={onPressFilters}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel={
                filterCount > 0 ? `Filters, ${filterCount} applied` : 'Filters'
              }
            >
              <HStack align="center" gap="xs">
                <Icon as={SlidersHorizontal} size="sm" tint={colors.primary} />
                <AppText variant="micro" color="primary">
                  {filterCount > 0 ? `Filters · ${filterCount}` : 'Filters'}
                </AppText>
              </HStack>
            </Pressable>
          </HStack>

          <Pressable
            onPress={onToggleInStock}
            feedback="opacity"
            accessibilityRole="switch"
            accessibilityState={{ checked: inStockOnly }}
            accessibilityLabel="In stock only"
          >
            <HStack align="center" gap="xs">
              <Icon
                as={PackageCheck}
                size="sm"
                tint={inStockOnly ? colors.success : colors.textTertiary}
              />
              <AppText
                variant="micro"
                color={inStockOnly ? 'success' : 'textSecondary'}
              >
                In stock only
              </AppText>
            </HStack>
          </Pressable>
        </HStack>
      </>
    );
  },
);

ShopBrowseToolbar.displayName = 'ShopBrowseToolbar';

const styles = StyleSheet.create({
  row: { gap: spacing.xs, alignItems: 'center' },
  chip: { borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  chipLabel: { fontWeight: '600' },
});
