import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { DailyOffersCard } from '../../components/shop/DailyOffersCard';
import { FeaturedRewardsRow } from '../../components/shop/FeaturedRewardsRow';
import { ShopAssuranceStrip } from '../../components/shop/ShopAssuranceStrip';
import {
  ShopCategoryFilter,
  type ShopFilter,
} from '../../components/shop/ShopCategoryFilter';
import { ShopCoinsBanner } from '../../components/shop/ShopCoinsBanner';
import { ShopHeader } from '../../components/shop/ShopHeader';
import { ShopItemDetailSheet } from '../../components/shop/ShopItemDetailSheet';
import { TopCategoriesGrid } from '../../components/shop/TopCategoriesGrid';
import { Screen } from '../../components/ui/Screen';
import { useToast } from '../../components/feedback/Toast';
import { shopItems } from '../../constants/seedData';
import { useCurrentUser } from '../../stores/authStore';
import {
  useCoinBalance,
  useCoinsStore,
  useCoinTransactions,
} from '../../stores/coinsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { formatCoins } from '../../utils/format';
import type { ShopItem } from '../../types/models';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.base },
  });

/**
 * The reward catalogue.
 *
 * A `ScrollView` of sections rather than a recycling list: the catalogue is a
 * fixed handful of items and only the featured shelf scrolls, sideways. Swap
 * the shelf to FlashList when the shop starts paging from the server.
 *
 * The filter row drives the featured shelf. Tapping a category tile lower
 * down sets the same filter, so the two are one control drawn twice — the
 * chips for a user who knows what they want, the tiles for one who is
 * browsing and wants to see how much is in each.
 */
export const ShopScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const toast = useToast();
  const user = useCurrentUser();
  const balance = useCoinBalance();
  const transactions = useCoinTransactions();
  const spend = useCoinsStore(s => s.spend);

  const [filter, setFilter] = useState<ShopFilter>('all');
  const [selected, setSelected] = useState<ShopItem | null>(null);

  // Every redemption is a purchase row in the ledger, so the ledger is the
  // order count — there is no second list of orders to fall out of step.
  const orderCount = useMemo(
    () => transactions.filter(t => t.source === 'purchase').length,
    [transactions],
  );

  const featured = useMemo(() => {
    if (filter === 'all') return shopItems;
    if (filter === 'deals') return shopItems.filter(item => item.isDeal);
    return shopItems.filter(item => item.category === filter);
  }, [filter]);

  const closeDetail = useCallback(() => setSelected(null), []);

  const handleRedeem = useCallback(
    (item: ShopItem) => {
      // The sheet already refuses to fire when the coins are short, but the
      // store is the thing that owns the balance: checking again here is what
      // makes a stale render unable to spend coins the user no longer has.
      const redeemed = spend(item.priceCoins, item.title, 'purchase');

      toast.show(
        redeemed
          ? {
              title: 'Redeemed',
              message: `${item.title} is on its way. ${formatCoins(
                item.priceCoins,
              )} coins deducted.`,
              tone: 'success',
            }
          : {
              title: 'Not enough coins',
              message: `${item.title} costs ${formatCoins(
                item.priceCoins,
              )} coins.`,
              tone: 'warning',
            },
      );
    },
    [spend, toast],
  );

  const onOpenAccount = useCallback(
    () => navigation.navigate('Main', { screen: 'Account' }),
    [navigation],
  );

  const showAll = useCallback(() => setFilter('all'), []);

  // Destinations the app has not built yet — orders, the daily offers page,
  // the full catalogue. Wired as no-ops rather than left off, so each row
  // keeps the shape it will ship with and only the handler changes.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ShopHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          orderCount={orderCount}
          onPressOrders={notImplemented}
          onPressAvatar={onOpenAccount}
        />

        <ShopCoinsBanner balance={balance} onPressBestRewards={showAll} />

        <ShopCategoryFilter value={filter} onChange={setFilter} />

        <FeaturedRewardsRow
          items={featured}
          onPressItem={setSelected}
          onPressViewAll={showAll}
        />

        <DailyOffersCard onPressDailyOffers={notImplemented} />

        <TopCategoriesGrid items={shopItems} onPressCategory={setFilter} />

        <ShopAssuranceStrip />
      </ScrollView>

      <ShopItemDetailSheet
        item={selected}
        balance={balance}
        onRedeem={handleRedeem}
        onClose={closeDetail}
      />
    </Screen>
  );
};
