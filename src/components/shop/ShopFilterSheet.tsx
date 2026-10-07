import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePaymentMode, useShopStore } from '../../stores/shopStore';
import { radius, spacing, useTheme } from '../../theme';
import { formatCoins, formatMoney } from '../../utils/format';
import { BottomSheet } from '../disclosure/BottomSheet';
import { Input } from '../form/Input';
import { Pressable } from '../form/Pressable';
import { Switch } from '../form/Switch';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';

/** What a catalogue page may be narrowed by, beyond its shelf and sort. */
export interface ShopFilters {
  /** Paise, inclusive. */
  minPrice?: number;
  maxPrice?: number;
  /** 1–5: items rated at least this. */
  minRating?: number;
  deals?: boolean;
  inStock?: boolean;
}

export const NO_FILTERS: ShopFilters = {};

/** How many of the filters are set — the count on the toolbar's button. */
export function countFilters(filters: ShopFilters): number {
  return (
    Number(filters.minPrice !== undefined || filters.maxPrice !== undefined) +
    Number(filters.minRating !== undefined) +
    Number(Boolean(filters.deals)) +
    Number(Boolean(filters.inStock))
  );
}

/** The price bands a shopper thinks in, in paise; `null` is an open end. */
const PRICE_BANDS: readonly {
  label: string;
  min: number | null;
  max: number | null;
}[] = [
  { label: 'Under ₹300', min: null, max: 29999 },
  { label: '₹300 – ₹600', min: 30000, max: 59999 },
  { label: '₹600 – ₹1,000', min: 60000, max: 99999 },
  { label: 'Over ₹1,000', min: 100000, max: null },
];

const RATING_FLOORS: readonly { label: string; value: number }[] = [
  { label: '3★ & up', value: 3 },
  { label: '4★ & up', value: 4 },
  { label: '4.5★ & up', value: 4.5 },
];

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

const Chip = memo(({ label, selected, onPress }: ChipProps) => {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      feedback="opacity"
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
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
    </Pressable>
  );
});

Chip.displayName = 'ShopFilterChip';

interface Props {
  visible: boolean;
  filters: ShopFilters;
  /** Called with the new filters when "Show results" is tapped. */
  onApply: (filters: ShopFilters) => void;
  onClose: () => void;
}

/** Rupees typed into a field, as paise; nothing or nonsense is unset. */
function paiseOf(text: string): number | undefined {
  const rupees = Number(text.replace(/[^\d.]/g, ''));
  return text.trim() !== '' && Number.isFinite(rupees) && rupees >= 0
    ? Math.round(rupees * 100)
    : undefined;
}

function rupeesOf(paise: number | undefined): string {
  return paise === undefined ? '' : String(Math.round(paise / 100));
}

/**
 * How the sheet reads and takes prices: rupees, or coins in a coins-only
 * shop (RULES R11). The filter is paise either way — the server's unit —
 * so a typed coin figure becomes paise at the till's coin value, the one
 * conversion the contract leaves to the app.
 */
interface PriceUnit {
  /** After "Min"/"Max" on the fields. */
  short: string;
  /** Read out with the fields. */
  spoken: string;
  toText: (paise: number | undefined) => string;
  fromText: (text: string) => number | undefined;
  format: (paise: number) => string;
  band: (band: (typeof PRICE_BANDS)[number]) => string;
}

const RUPEES: PriceUnit = {
  short: '₹',
  spoken: 'rupees',
  toText: rupeesOf,
  fromText: paiseOf,
  format: paise => formatMoney(paise),
  band: band => band.label,
};

function coinUnit(coinValuePaise: number): PriceUnit {
  const coinsOf = (paise: number) => Math.round(paise / coinValuePaise);
  const words = (paise: number) => formatCoins(coinsOf(paise));
  return {
    short: 'coins',
    spoken: 'coins',
    toText: paise => (paise === undefined ? '' : String(coinsOf(paise))),
    fromText: text => {
      const coins = Number(text.replace(/[^\d]/g, ''));
      return text.trim() !== '' && Number.isFinite(coins) && coins >= 0
        ? coins * coinValuePaise
        : undefined;
    },
    format: paise => `${words(paise)} coins`,
    // A band's top is the last paisa under the next one, so its edge is one on.
    band: ({ min, max }) =>
      min === null
        ? `Under ${words((max ?? 0) + 1)} coins`
        : max === null
        ? `Over ${words(min)} coins`
        : `${words(min)} – ${words(max + 1)} coins`,
  };
}

/**
 * The narrowing a catalogue page offers: a price band or a price of the
 * user's own, a star floor, deals, stock.
 *
 * The sheet edits a draft and applies it on "Show results", rather than
 * refetching on every tap: a user setting a band and a rating would
 * otherwise watch the list rebuild twice under the sheet. "Clear all"
 * applies too — an emptied sheet that then had to be confirmed would look
 * like it had not worked.
 */
export const ShopFilterSheet = memo(
  ({ visible, filters, onApply, onClose }: Props) => {
    const mode = usePaymentMode();
    const coinValue = useShopStore(s => s.config?.coinValuePaise ?? null);
    const unit = useMemo(
      () =>
        mode === 'coins' && coinValue !== null ? coinUnit(coinValue) : RUPEES,
      [coinValue, mode],
    );
    const [draft, setDraft] = useState<ShopFilters>(filters);
    const [minText, setMinText] = useState(unit.toText(filters.minPrice));
    const [maxText, setMaxText] = useState(unit.toText(filters.maxPrice));

    // Opening starts from what is applied, not from the last unapplied draft.
    useEffect(() => {
      if (visible) {
        setDraft(filters);
        setMinText(unit.toText(filters.minPrice));
        setMaxText(unit.toText(filters.maxPrice));
      }
    }, [filters, unit, visible]);

    const pickBand = useCallback(
      (min: number | null, max: number | null) => {
        setDraft(current => {
          const same =
            (current.minPrice ?? null) === min &&
            (current.maxPrice ?? null) === max;
          const next = { ...current };
          if (same) {
            delete next.minPrice;
            delete next.maxPrice;
          } else {
            if (min === null) delete next.minPrice;
            else next.minPrice = min;
            if (max === null) delete next.maxPrice;
            else next.maxPrice = max;
          }
          setMinText(unit.toText(next.minPrice));
          setMaxText(unit.toText(next.maxPrice));
          return next;
        });
      },
      [unit],
    );

    const onChangeMin = useCallback(
      (text: string) => {
        setMinText(text);
        setDraft(current => {
          const next = { ...current };
          const value = unit.fromText(text);
          if (value === undefined) delete next.minPrice;
          else next.minPrice = value;
          return next;
        });
      },
      [unit],
    );

    const onChangeMax = useCallback(
      (text: string) => {
        setMaxText(text);
        setDraft(current => {
          const next = { ...current };
          const value = unit.fromText(text);
          if (value === undefined) delete next.maxPrice;
          else next.maxPrice = value;
          return next;
        });
      },
      [unit],
    );

    const pickRating = useCallback((value: number) => {
      setDraft(current => {
        const next = { ...current };
        if (current.minRating === value) delete next.minRating;
        else next.minRating = value;
        return next;
      });
    }, []);

    const setDeals = useCallback(
      (value: boolean) =>
        setDraft(current => ({ ...current, deals: value || undefined })),
      [],
    );
    const setInStock = useCallback(
      (value: boolean) =>
        setDraft(current => ({ ...current, inStock: value || undefined })),
      [],
    );

    const apply = useCallback(() => {
      // A min above the max is the user's slip, not a filter: swap them.
      const next = { ...draft };
      if (
        next.minPrice !== undefined &&
        next.maxPrice !== undefined &&
        next.minPrice > next.maxPrice
      ) {
        [next.minPrice, next.maxPrice] = [next.maxPrice, next.minPrice];
      }
      onApply(next);
      onClose();
    }, [draft, onApply, onClose]);

    const clear = useCallback(() => {
      onApply(NO_FILTERS);
      onClose();
    }, [onApply, onClose]);

    const bandSelected = (min: number | null, max: number | null) =>
      (draft.minPrice ?? null) === min && (draft.maxPrice ?? null) === max;
    const summary =
      draft.minPrice !== undefined || draft.maxPrice !== undefined
        ? `${
            draft.minPrice !== undefined ? unit.format(draft.minPrice) : 'Any'
          } to ${
            draft.maxPrice !== undefined ? unit.format(draft.maxPrice) : 'any'
          }`
        : 'Any price';

    return (
      <BottomSheet visible={visible} onClose={onClose} title="Filters">
        <VStack gap="lg" pb="base">
          <VStack gap="sm">
            <HStack align="center" justify="between">
              <AppText variant="label" color="textSecondary">
                Price
              </AppText>
              <AppText variant="micro" color="textTertiary">
                {summary}
              </AppText>
            </HStack>
            <HStack gap="xs" wrap>
              {PRICE_BANDS.map(band => (
                <Chip
                  key={band.label}
                  label={unit.band(band)}
                  selected={bandSelected(band.min, band.max)}
                  onPress={() => pickBand(band.min, band.max)}
                />
              ))}
            </HStack>
            <HStack gap="sm">
              <Input
                label={`Min ${unit.short}`}
                value={minText}
                onChangeText={onChangeMin}
                keyboardType="number-pad"
                placeholder="0"
                style={styles.field}
                accessibilityLabel={`Minimum price in ${unit.spoken}`}
              />
              <Input
                label={`Max ${unit.short}`}
                value={maxText}
                onChangeText={onChangeMax}
                keyboardType="number-pad"
                placeholder="Any"
                style={styles.field}
                accessibilityLabel={`Maximum price in ${unit.spoken}`}
              />
            </HStack>
          </VStack>

          <VStack gap="sm">
            <AppText variant="label" color="textSecondary">
              Rating
            </AppText>
            <HStack gap="xs" wrap>
              {RATING_FLOORS.map(floor => (
                <Chip
                  key={floor.value}
                  label={floor.label}
                  selected={draft.minRating === floor.value}
                  onPress={() => pickRating(floor.value)}
                />
              ))}
            </HStack>
          </VStack>

          <VStack gap="xs">
            <Switch
              label="Deals only"
              value={Boolean(draft.deals)}
              onChange={setDeals}
            />
            <Switch
              label="In stock only"
              value={Boolean(draft.inStock)}
              onChange={setInStock}
            />
          </VStack>

          <HStack gap="sm">
            <View style={styles.grow}>
              <Button
                label="Clear all"
                variant="secondary"
                onPress={clear}
                fullWidth
              />
            </View>
            <View style={styles.grow}>
              <Button
                label="Show results"
                variant="brand"
                onPress={apply}
                fullWidth
              />
            </View>
          </HStack>
        </VStack>
      </BottomSheet>
    );
  },
);

ShopFilterSheet.displayName = 'ShopFilterSheet';

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: { fontWeight: '600' },
  field: { flex: 1 },
  grow: { flex: 1 },
});
