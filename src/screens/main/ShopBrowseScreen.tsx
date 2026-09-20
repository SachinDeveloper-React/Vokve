import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { VStack } from '../../components/layout/Stack';
import { presentationOf } from '../../components/shop/categories';
import {
  SORT_LABEL,
  ShopBrowseToolbar,
} from '../../components/shop/ShopBrowseToolbar';
import {
  NO_FILTERS,
  ShopFilterSheet,
  countFilters,
  type ShopFilters,
} from '../../components/shop/ShopFilterSheet';
import { ShopItemCard } from '../../components/shop/ShopItemCard';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useCatalogue } from '../../hooks/useCatalogue';
import { useCoinBalance } from '../../stores/coinsStore';
import { useShopCategories } from '../../stores/shopStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { ShopItem, ShopSort } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl },
    header: { gap: spacing.md, paddingBottom: spacing.md },
    /** Each cell takes half the width less the gutter; the gap is the gutter. */
    cell: { flex: 1, padding: spacing.xs },
    footer: {
      paddingVertical: spacing.lg,
      alignItems: 'center',
      gap: spacing.sm,
    },
    empty: { paddingVertical: spacing.xl },
  });

const SORTS: readonly ShopSort[] = [
  'popular',
  'rating',
  'price_asc',
  'price_desc',
  'newest',
];

/**
 * A page of the catalogue: one shelf, the deals, or everything — from the
 * server, two cards across, paged as the user scrolls, sorted how they ask,
 * narrowed to a subcategory or to what is in stock.
 *
 * The shop's own screen shows a shelf of what the store already holds; this
 * is where the rest of it lives, and it never reads the store for rows —
 * only for the shelf's subcategories, which the tiles' summary already
 * carries. Buying works exactly as it does on the shop: the same hook, the
 * same two sheets.
 */
export const ShopBrowseScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'ShopBrowse'>['route']>();
  const balance = useCoinBalance();
  const summaries = useShopCategories();

  const category = route.params?.category;
  const deals = route.params?.deals === true;

  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [sort, setSort] = useState<ShopSort>('popular');
  const [filters, setFilters] = useState<ShopFilters>(NO_FILTERS);
  const [isSortOpen, setSortOpen] = useState(false);
  const [isFiltersOpen, setFiltersOpen] = useState(false);
  const inStockOnly = Boolean(filters.inStock);

  const query = useMemo(
    () => ({
      category,
      deals: deals || filters.deals || undefined,
      subcategory: subcategory ?? undefined,
      sort,
      inStock: filters.inStock || undefined,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      minRating: filters.minRating,
    }),
    [category, deals, filters, sort, subcategory],
  );
  const catalogue = useCatalogue(query);

  const presentation = category ? presentationOf(category) : null;
  const title =
    route.params?.title ??
    (deals ? "Today's deals" : presentation?.label ?? 'All rewards');
  const subtitle =
    catalogue.total === null
      ? ' '
      : `${catalogue.total} ${catalogue.total === 1 ? 'reward' : 'rewards'}${
          inStockOnly ? ' in stock' : ''
        }`;
  const subcategories = useMemo(
    () =>
      category
        ? summaries?.find(entry => entry.category === category)
            ?.subcategories ?? []
        : [],
    [category, summaries],
  );

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Shop' });
  }, [navigation]);

  const openSort = useCallback(() => setSortOpen(true), []);
  const closeSort = useCallback(() => setSortOpen(false), []);
  const openFilters = useCallback(() => setFiltersOpen(true), []);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  const toggleInStock = useCallback(
    () =>
      setFilters(current => ({
        ...current,
        inStock: current.inStock ? undefined : true,
      })),
    [],
  );
  const onOpenItem = useCallback(
    (item: ShopItem) => navigation.navigate('ProductDetail', { id: item.id }),
    [navigation],
  );
  const sortActions = useMemo(
    () =>
      SORTS.map(value => ({
        label: SORT_LABEL[value],
        disabled: value === sort,
        onPress: () => setSort(value),
      })),
    [sort],
  );

  const renderItem = useCallback<ListRenderItem<ShopItem>>(
    ({ item }) => (
      <View style={styles.cell}>
        <ShopItemCard item={item} onPress={onOpenItem} fill />
      </View>
    ),
    [onOpenItem, styles.cell],
  );
  const keyExtractor = useCallback((item: ShopItem) => item.id, []);

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title={title}
          subtitle={subtitle}
        />
        <ShopBrowseToolbar
          subcategories={subcategories}
          subcategory={subcategory}
          onChangeSubcategory={setSubcategory}
          sort={sort}
          onPressSort={openSort}
          inStockOnly={inStockOnly}
          onToggleInStock={toggleInStock}
          filterCount={countFilters(filters)}
          onPressFilters={openFilters}
        />
      </View>
    ),
    [
      balance,
      filters,
      inStockOnly,
      onPressBack,
      openFilters,
      openSort,
      sort,
      styles.header,
      subcategories,
      subcategory,
      subtitle,
      title,
      toggleInStock,
    ],
  );

  const empty = useMemo(() => {
    if (catalogue.isLoading) {
      return (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (catalogue.error) {
      return (
        <Card radius="xl" style={styles.empty}>
          <EmptyState
            title="Couldn't load the shop"
            message={catalogue.error}
            actionLabel="Try again"
            onAction={catalogue.retry}
          />
        </Card>
      );
    }
    return (
      <Card radius="xl" style={styles.empty}>
        <EmptyState
          title="Nothing here right now"
          message={
            countFilters(filters) > 0
              ? 'Nothing matches those filters. Loosen one, or clear them all.'
              : 'Check back after the next drop.'
          }
          actionLabel={countFilters(filters) > 0 ? 'Clear filters' : undefined}
          onAction={
            countFilters(filters) > 0 ? () => setFilters(NO_FILTERS) : undefined
          }
        />
      </Card>
    );
  }, [
    catalogue.error,
    catalogue.isLoading,
    catalogue.retry,
    colors.primary,
    filters,
    styles.empty,
  ]);

  const footer = useMemo(() => {
    if (catalogue.isLoadingMore) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (catalogue.error && catalogue.items.length > 0) {
      return (
        <VStack style={styles.footer}>
          <AppText variant="caption" color="textSecondary" center>
            {catalogue.error}
          </AppText>
          <Button
            label="Try again"
            variant="secondary"
            size="sm"
            onPress={catalogue.retry}
          />
        </VStack>
      );
    }
    return null;
  }, [
    catalogue.error,
    catalogue.isLoadingMore,
    catalogue.items.length,
    catalogue.retry,
    colors.primary,
    styles.footer,
  ]);

  return (
    <Screen edges={['top']}>
      <FlashList
        data={catalogue.items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={2}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={catalogue.loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={catalogue.isRefreshing}
            onRefresh={catalogue.refresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      />

      <ActionSheet
        visible={isSortOpen}
        onClose={closeSort}
        title="Sort by"
        actions={sortActions}
      />

      <ShopFilterSheet
        visible={isFiltersOpen}
        filters={filters}
        onApply={setFilters}
        onClose={closeFilters}
      />
    </Screen>
  );
};
