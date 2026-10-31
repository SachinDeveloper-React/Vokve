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
import { ReferralPromoCard } from '../../components/referral/ReferralPromoCard';
import { Screen } from '../../components/ui/Screen';
import { useReferralCard } from '../../hooks/useContent';
import { useAfterTransition } from '../../hooks/useAfterTransition';
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
import { whenIdle, type Idle } from '../../utils/idle';

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
 * The shop's front: a search field, the featured shelf, the category tiles,
 * the deals card — each a door to a page that pages from the server.
 *
 * A `ScrollView` of sections rather than a recycling list: only the shelf
 * scrolls, sideways, and it holds the featured rows of a catalogue the
 * store already has. Everything longer than that lives on the browse
 * screen, which is a list and knows how to load more.
 *
 * The filter row narrows the shelf in place, for a user browsing here; the
 * tiles lower down open the category's own page, for one who wants all of
 * it. Both are the same shelves — whatever the server is carrying — drawn
 * twice.
 *
 * **The tab changes before any of this happens.** Everything below the
 * chips is the expensive half — a shelf of cards with their art, the
 * category tiles, the offers — and mounting it in the same frame as the tab
 * press is what made the Shop tab feel stuck on Android: the press lands,
 * the bar waits for this screen's first commit, and nothing moves until it
 * is done. So the cheap half paints first and the rest is gated on
 * `useAfterTransition`; the catalogue sync waits for the same moment,
 * rather than competing with the transition for the thread it is running on.
 */
export const ShopScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();

  /**
   * The invite card for this screen, as the server wrote it — null where the
   * operator has not put one here, and then nothing is drawn.
   */
  const referralCard = useReferralCard('shop');
  const onOpenReferral = useCallback(
    () => navigation.navigate('Referral'),
    [navigation],
  );
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
  const ready = useAfterTransition();

  // The catalogue is stock-aware, so the tab refreshes on focus — stale-checked,
  // and only with a session, like the wallet.
  //
  // After the interaction, never inside it: the sync parses a hundred items
  // and sets the store, and doing that while the tab is still animating puts
  // both on the same thread with the bar waiting. Re-armed on every focus,
  // because coming back to the tab is a transition too.
  useEffect(() => {
    if (!isSignedIn) {
      return undefined;
    }
    let idle: Idle | null = null;
    const refresh = () => {
      idle?.cancel();
      idle = whenIdle(() => {
        idle = null;
        refreshCatalogueIfStale();
      });
    };
    refresh();
    const stopListening = navigation.addListener('focus', refresh);
    return () => {
      idle?.cancel();
      stopListening();
    };
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

        <ReferralPromoCard
          card={referralCard}
          at="top"
          onPress={onOpenReferral}
        />

        <ShopCategoryFilter
          value={filter}
          onChange={setFilter}
          categories={categories}
        />

        {!ready || catalogueSyncedAt === null ? (
          <LoadState
            loading={!ready || isCatalogueSyncing || catalogueError === null}
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

        <ReferralPromoCard
          card={referralCard}
          at="middle"
          onPress={onOpenReferral}
        />

        <ShopAssuranceStrip />
        <ReferralPromoCard card={referralCard} onPress={onOpenReferral} />
      </ScrollView>
    </Screen>
  );
};
