import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner';
import { DailyOffersCard } from '../../components/shop/DailyOffersCard';
import { FeaturedRewardsRow } from '../../components/shop/FeaturedRewardsRow';
import { RedeemConfirmSheet } from '../../components/shop/RedeemConfirmSheet';
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
import {
  useAddressesStore,
  useDefaultAddress,
} from '../../stores/addressesStore';
import {
  useAuthStatus,
  useCurrentUser,
  usePendingContactVerification,
  useStepUpToken,
} from '../../stores/authStore';
import { useCoinBalance, useStepUpThreshold } from '../../stores/coinsStore';
import { useOrderCount } from '../../stores/ordersStore';
import {
  useIsRedeeming,
  usePendingRedeem,
  useShopItems,
  useShopStore,
  type RedeemOutcome,
} from '../../stores/shopStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { formatCoins } from '../../utils/format';
import type { Address, ShopItem } from '../../types/models';

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
  const { colors } = useTheme();
  const navigation = useNavigation();
  const toast = useToast();
  const user = useCurrentUser();
  const balance = useCoinBalance();
  const stepUpThreshold = useStepUpThreshold();
  const isSignedIn = useAuthStatus() === 'authenticated';

  const shopItems = useShopItems();
  const isCatalogueSyncing = useShopStore(s => s.isSyncing);
  const catalogueSyncedAt = useShopStore(s => s.syncedAt);
  const hydrateCatalogue = useShopStore(s => s.hydrateFromServer);
  const refreshCatalogueIfStale = useShopStore(s => s.refreshIfStale);
  const redeem = useShopStore(s => s.redeem);
  const resumeAfterStepUp = useShopStore(s => s.resumeAfterStepUp);
  const abandonRedeem = useShopStore(s => s.abandonRedeem);
  const isRedeeming = useIsRedeeming();
  const pendingRedeem = usePendingRedeem();

  // The count is the server's — orders, not purchase rows (RULES R7).
  const orderCount = useOrderCount();
  const defaultAddress = useDefaultAddress();
  const hydrateAddresses = useAddressesStore(s => s.hydrateFromServer);

  const stepUpToken = useStepUpToken();
  const pendingContact = usePendingContactVerification();

  const [filter, setFilter] = useState<ShopFilter>('all');
  const [selected, setSelected] = useState<ShopItem | null>(null);
  /** The reward the checkout sheet is open for, or null. */
  const [checkout, setCheckout] = useState<ShopItem | null>(null);

  // The catalogue is stock-aware, so the tab refreshes on focus — stale-checked,
  // and only with a session, like the wallet.
  useEffect(() => {
    if (!isSignedIn) {
      return undefined;
    }
    refreshCatalogueIfStale();
    return navigation.addListener('focus', refreshCatalogueIfStale);
  }, [isSignedIn, navigation, refreshCatalogueIfStale]);

  const featured = useMemo(() => {
    if (filter === 'all') return shopItems;
    if (filter === 'deals') return shopItems.filter(item => item.isDeal);
    return shopItems.filter(item => item.category === filter);
  }, [filter, shopItems]);

  const closeDetail = useCallback(() => setSelected(null), []);
  const closeCheckout = useCallback(() => setCheckout(null), []);

  // The detail sheet closes itself on Redeem; the checkout opens in its
  // place, because React Native's modals do not stack.
  const openCheckout = useCallback((item: ShopItem) => setCheckout(item), []);

  /** What each outcome says to the user, in one place for the first try and the resume. */
  const announce = useCallback(
    (item: ShopItem, outcome: RedeemOutcome) => {
      switch (outcome.status) {
        case 'placed':
          setCheckout(null);
          toast.show({
            title: 'Redeemed',
            message: `${item.title} is on its way. ${formatCoins(
              item.priceCoins,
            )} coins deducted.`,
            tone: 'success',
          });
          return;
        case 'step_up_required':
          // The OTP screen is opening over the shop; the sheet would sit
          // underneath it and greet the user twice on the way back.
          setCheckout(null);
          return;
        case 'address_required':
          hydrateAddresses();
          toast.show({
            title: 'Add an address first',
            message: 'Rewards are posted to you — tell us where.',
            tone: 'warning',
          });
          return;
        case 'failed':
          toast.show({
            title:
              outcome.error.code === 'INSUFFICIENT_COINS'
                ? 'Not enough coins'
                : outcome.error.code === 'OUT_OF_STOCK'
                ? 'Sold out'
                : "Couldn't redeem",
            message: outcome.error.message,
            tone: outcome.error.code === 'OUT_OF_STOCK' ? 'warning' : 'error',
          });
          if (outcome.error.code === 'OUT_OF_STOCK') {
            setCheckout(null);
            hydrateCatalogue();
          }
      }
    },
    [hydrateAddresses, hydrateCatalogue, toast],
  );

  const confirmRedeem = useCallback(
    async (item: ShopItem, address: Address) => {
      const outcome = await redeem({ itemId: item.id, addressId: address.id });
      announce(item, outcome);
    },
    [announce, redeem],
  );

  // The step-up came back with a token: finish what it interrupted.
  useEffect(() => {
    if (!stepUpToken || !pendingRedeem) {
      return;
    }
    const item = shopItems.find(entry => entry.id === pendingRedeem.itemId);
    resumeAfterStepUp().then(outcome => {
      if (outcome && item) {
        announce(item, outcome);
      }
    });
  }, [announce, pendingRedeem, resumeAfterStepUp, shopItems, stepUpToken]);

  // The OTP screen closed without a token — the user backed out. The attempt
  // is dropped rather than left waiting for a code that will never come.
  useEffect(() => {
    if (pendingRedeem && !pendingContact && !stepUpToken) {
      abandonRedeem();
      toast.show({ title: 'Redemption cancelled', tone: 'info' });
    }
  }, [abandonRedeem, pendingContact, pendingRedeem, stepUpToken, toast]);

  const onOpenAccount = useCallback(
    () => navigation.navigate('Main', { screen: 'Account' }),
    [navigation],
  );
  const onOpenOrders = useCallback(
    () => navigation.navigate('Orders'),
    [navigation],
  );
  // From the checkout: pick another address, or add the first. The sheet
  // stays open underneath and reads the new default on return.
  const onPressAddress = useCallback(() => {
    if (defaultAddress) {
      navigation.navigate('Addresses', { select: true });
    } else {
      navigation.navigate('AddressForm');
    }
  }, [defaultAddress, navigation]);

  const showAll = useCallback(() => setFilter('all'), []);

  // The daily offers page has no screen yet. Wired as a no-op rather than
  // left off, so the card keeps the shape it will ship with.
  const notImplemented = useCallback(() => {}, []);

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
          orderCount={orderCount}
          onPressOrders={onOpenOrders}
          onPressAvatar={onOpenAccount}
        />

        <EmailVerificationBanner reason="redeem rewards" />
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
        onRedeem={openCheckout}
        onClose={closeDetail}
      />

      <RedeemConfirmSheet
        item={checkout}
        balance={balance}
        address={defaultAddress}
        stepUpThreshold={stepUpThreshold}
        isRedeeming={isRedeeming}
        onConfirm={confirmRedeem}
        onPressAddress={onPressAddress}
        onClose={closeCheckout}
      />
    </Screen>
  );
};
