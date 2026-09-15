import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner';
import { CoinBalanceCard } from '../../components/wallet/CoinBalanceCard';
import { CoinExpirySheet } from '../../components/wallet/CoinExpirySheet';
import { CoinsSummaryCard } from '../../components/wallet/CoinsSummaryCard';
import { KeepGoingCard } from '../../components/wallet/KeepGoingCard';
import { RecentTransactionsCard } from '../../components/wallet/RecentTransactionsCard';
import { WalletActionsRow } from '../../components/wallet/WalletActionsRow';
import { WalletHeader } from '../../components/wallet/WalletHeader';
import { WalletSyncNotice } from '../../components/wallet/WalletSyncNotice';
import { Screen } from '../../components/ui/Screen';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { useAuthStatus, useCurrentUser } from '../../stores/authStore';
import { useHasUnreadNotifications } from '../../stores/notificationsStore';
import {
  useCoinBalance,
  useCoinExpiry,
  useCoinTransactions,
  useCoinsStore,
  useIsWalletSyncing,
  useLifetimeEarned,
  useMonthlyCoinSummary,
  usePendingCoins,
  useWalletSyncError,
  useWalletSyncedAt,
} from '../../stores/coinsStore';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * The coin wallet: what the user holds, what it is worth doing about it, and
 * where the coins have been going.
 *
 * A `ScrollView` of cards rather than a list with a header. The ledger here is
 * a fixed four rows behind a "View All" — nothing on the screen grows without
 * bound, so a virtualised list would cost a recycler and buy nothing.
 *
 * Every figure is the server's (BACKEND.md §8): the store is a cache of the
 * last `GET /wallet`, refreshed when the tab comes into view if it has gone
 * stale, and on demand by pulling down. The screen never computes a balance.
 */
export const WalletScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const user = useCurrentUser();
  const isSignedIn = useAuthStatus() === 'authenticated';

  const balance = useCoinBalance();
  const pending = usePendingCoins();
  const lifetimeEarned = useLifetimeEarned();
  const transactions = useCoinTransactions();
  const summary = useMonthlyCoinSummary();
  const expiry = useCoinExpiry();
  const hasUnreadNotifications = useHasUnreadNotifications();

  const isSyncing = useIsWalletSyncing();
  const syncError = useWalletSyncError();
  const syncedAt = useWalletSyncedAt();
  const hydrateFromServer = useCoinsStore(s => s.hydrateFromServer);
  const refreshIfStale = useCoinsStore(s => s.refreshIfStale);

  // The tab stays mounted, so "opened" means focused, not mounted: a workout
  // finished on another tab has paid out by the time the user comes back
  // here, and the balance should say so without a pull. Stale-checked, so
  // flicking between tabs does not fire a request each time. Only with a
  // session: the dev bypass opens this tab without one, and a wallet that
  // greeted every developer with "couldn't refresh" would be crying wolf.
  useEffect(() => {
    if (!isSignedIn) {
      return undefined;
    }
    refreshIfStale();
    return navigation.addListener('focus', refreshIfStale);
  }, [isSignedIn, navigation, refreshIfStale]);

  // The spinner follows the pull, not every sync: a background refresh on
  // focus must not drop a spinner into a screen the user did not pull.
  const [isPulling, setPulling] = useState(false);
  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await hydrateFromServer();
    } finally {
      setPulling(false);
    }
  }, [hydrateFromServer]);

  const onOpenShop = useCallback(
    () => navigation.navigate('Main', { screen: 'Shop' }),
    [navigation],
  );

  const onOpenAccount = useCallback(
    () => navigation.navigate('Main', { screen: 'Account' }),
    [navigation],
  );

  // Referrals are the one way to earn coins that is not already on the
  // dashboard, which is what "Earn Coins" is asking for.
  const onOpenReferral = useCallback(
    () => navigation.navigate('Referral'),
    [navigation],
  );

  const onOpenNotifications = useCallback(
    () => navigation.navigate('Notifications'),
    [navigation],
  );

  // Both the action tile and the ledger's "View All" lead to the same place:
  // the tile is the named way in, the link is the one a user finds while
  // reading the rows.
  const onOpenHistory = useCallback(
    () => navigation.navigate('CoinHistory'),
    [navigation],
  );

  // The expiry explainer is a sheet over the wallet, opened from either the
  // panel's button or the "?" on its label — two affordances, one answer.
  const [isExpiryOpen, setExpiryOpen] = useState(false);
  const openExpiry = useCallback(() => setExpiryOpen(true), []);
  const closeExpiry = useCallback(() => setExpiryOpen(false), []);
  // Closes first: a modal left open under a pushed screen is still there
  // when the user comes back, over a wallet they have already read.
  const onEarnFromExpiry = useCallback(() => {
    setExpiryOpen(false);
    navigation.navigate('Referral');
  }, [navigation]);

  // Orders has no screen yet. Wired as a no-op rather than left off, so the
  // row keeps the shape it will ship with and only the handler changes when
  // the screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isPulling}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <WalletHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          hasUnreadNotifications={hasUnreadNotifications}
          onPressNotifications={onOpenNotifications}
          onPressAvatar={onOpenAccount}
        />

        <EmailVerificationBanner reason="redeem your coins" />

        <WalletSyncNotice
          error={syncError}
          syncedAt={syncedAt}
          isRetrying={isSyncing}
          onRetry={hydrateFromServer}
        />

        <CoinBalanceCard
          balance={balance}
          pending={pending}
          lifetimeEarned={lifetimeEarned}
          expiryDaysLeft={expiry.daysLeft}
          expiryUrgency={expiry.urgency}
          onPressAboutExpiry={openExpiry}
          onPressExpiryInfo={openExpiry}
        />

        <WalletActionsRow
          onPressEarn={onOpenReferral}
          onPressShop={onOpenShop}
          onPressHistory={onOpenHistory}
          onPressOrders={notImplemented}
        />

        <KeepGoingCard />

        <RecentTransactionsCard
          transactions={transactions}
          onPressViewAll={onOpenHistory}
        />

        <CoinsSummaryCard
          earned={summary.earned}
          spent={summary.spent}
          net={summary.net}
        />
      </ScrollView>

      <CoinExpirySheet
        visible={isExpiryOpen}
        onClose={closeExpiry}
        balance={balance}
        expiry={expiry}
        onPressEarn={onEarnFromExpiry}
      />
    </Screen>
  );
};
