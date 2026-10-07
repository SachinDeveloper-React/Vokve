import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner';
import { DailyOffersCard } from '../../components/shop/DailyOffersCard';
import { FeaturedRewardsRow } from '../../components/shop/FeaturedRewardsRow';
import { ShopAssuranceStrip } from '../../components/shop/ShopAssuranceStrip';
import {
  ShopCategoryFilter,
  type ShopFilter,
} from '../../components/shop/ShopCategoryFilter';
import { ShopCoinsBanner } from '../../components/shop/ShopCoinsBanner';
import { ShopHeader } from '../../components/shop/ShopHeader';
import { ShopSearchBar } from '../../components/shop/ShopSearchBar';
import { TopCategoriesGrid } from '../../components/shop/TopCategoriesGrid';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useAuthStatus, useCurrentUser } from '../../stores/authStore';
import { useCartCount } from '../../stores/cartStore';
import { useCoinBalance } from '../../stores/coinsStore';
import {
  usePaymentMode,
  useShopCategories,
  useShopItems,
  useShopStore,
} from '../../stores/shopStore';
import { useWishlistCount } from '../../stores/wishlistStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { PaymentMode, ShopCategory, ShopItem } from '../../types/models';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.base },
  });

/** The line under the shop's name: what paying here means (RULES R11). */
const SUBTITLE: Record<PaymentMode, string> = {
  coins: 'Redeem your coins for gear you will use',
  money: 'Gear up for every workout',
  mixed: 'Gear up — pay with money, coins, or both',
};

/**
 * The shop's front: a search field, the featured shelf, the four category
 * tiles, the deals card — each a door to a page that pages from the server.
 *
 * A `ScrollView` of sections rather than a recycling list: only the shelf
 * scrolls, sideways, and it holds the featured rows of a catalogue the
 * store already has. Everything longer than that lives on the browse
 * screen, which is a list and knows how to load more.
 *
 * The filter row narrows the shelf in place, for a user browsing here; the
 * tiles lower down open the category's own page, for one who wants all of
 * it. Both are the same four categories, drawn twice.
 */
export const ShopScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const user = useCurrentUser();
  const balance = useCoinBalance();
  const isSignedIn = useAuthStatus() === 'authenticated';

  const shopItems = useShopItems();
  const categories = useShopCategories();
  const isCatalogueSyncing = useShopStore(s => s.isSyncing);
  const catalogueSyncedAt = useShopStore(s => s.syncedAt);
  const catalogueError = useShopStore(s => s.syncError);
  const hydrateCatalogue = useShopStore(s => s.hydrateFromServer);
  const refreshCatalogueIfStale = useShopStore(s => s.refreshIfStale);

  const cartCount = useCartCount();
  const paymentMode = usePaymentMode();
  const wishlistCount = useWishlistCount();

  const [filter, setFilter] = useState<ShopFilter>('all');

  // The catalogue is stock-aware, so the tab refreshes on focus — stale-checked,
  // and only with a session, like the wallet.
  useEffect(() => {
    if (!isSignedIn) {
      return undefined;
    }
    refreshCatalogueIfStale();
    return navigation.addListener('focus', refreshCatalogueIfStale);
  }, [isSignedIn, navigation, refreshCatalogueIfStale]);

  // The shelf: featured items first, then the rest, under the chosen chip.
  const featured = useMemo(() => {
    const pool =
      filter === 'all'
        ? shopItems
        : filter === 'deals'
        ? shopItems.filter(item => item.isDeal)
        : shopItems.filter(item => item.category === filter);
    return [...pool].sort((a, b) => Number(b.featured) - Number(a.featured));
  }, [filter, shopItems]);

  const onOpenAccount = useCallback(
    () => navigation.navigate('Main', { screen: 'Account' }),
    [navigation],
  );
  const onOpenCart = useCallback(
    () => navigation.navigate('Cart'),
    [navigation],
  );
  const onOpenWishlist = useCallback(
    () => navigation.navigate('Wishlist'),
    [navigation],
  );
  const onOpenItem = useCallback(
    (item: ShopItem) => navigation.navigate('ProductDetail', { id: item.id }),
    [navigation],
  );
  const onOpenSearch = useCallback(
    () => navigation.navigate('ShopSearch'),
    [navigation],
  );
  const onOpenAll = useCallback(
    () => navigation.navigate('ShopBrowse', { title: 'All rewards' }),
    [navigation],
  );
  const onOpenDeals = useCallback(
    () => navigation.navigate('ShopBrowse', { deals: true }),
    [navigation],
  );
  const onOpenCategory = useCallback(
    (category: ShopCategory) => navigation.navigate('ShopBrowse', { category }),
    [navigation],
  );

  // "View All" on the shelf opens whatever the chips are showing, in full.
  const onViewAllShelf = useCallback(() => {
    if (filter === 'all') {
      onOpenAll();
    } else if (filter === 'deals') {
      onOpenDeals();
    } else {
      onOpenCategory(filter);
    }
  }, [filter, onOpenAll, onOpenCategory, onOpenDeals]);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isCatalogueSyncing && catalogueSyncedAt !== null}
            onRefresh={hydrateCatalogue}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <ShopHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          cartCount={cartCount}
          wishlistCount={wishlistCount}
          onPressCart={onOpenCart}
          onPressWishlist={onOpenWishlist}
          onPressAvatar={onOpenAccount}
          subtitle={SUBTITLE[paymentMode]}
        />

        <ShopSearchBar onPress={onOpenSearch} />

        <EmailVerificationBanner reason="place orders" />
        <ShopCoinsBanner balance={balance} onPressBestRewards={onOpenAll} />

        <ShopCategoryFilter value={filter} onChange={setFilter} />

        {catalogueSyncedAt === null ? (
          <LoadState
            loading={isCatalogueSyncing || catalogueError === null}
            title="Couldn't load the shop"
            message={catalogueError}
            onRetry={hydrateCatalogue}
          />
        ) : (
          <>
            <FeaturedRewardsRow
              items={featured}
              onPressItem={onOpenItem}
              onPressViewAll={onViewAllShelf}
            />

            <DailyOffersCard onPressDailyOffers={onOpenDeals} />

            <TopCategoriesGrid
              items={shopItems}
              summaries={categories}
              onPressCategory={onOpenCategory}
            />
          </>
        )}

        <ShopAssuranceStrip />
      </ScrollView>
    </Screen>
  );
};
