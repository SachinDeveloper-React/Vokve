import React, { useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CoinBalanceCard } from '../../components/wallet/CoinBalanceCard';
import { CoinsSummaryCard } from '../../components/wallet/CoinsSummaryCard';
import { KeepGoingCard } from '../../components/wallet/KeepGoingCard';
import { RecentTransactionsCard } from '../../components/wallet/RecentTransactionsCard';
import { WalletActionsRow } from '../../components/wallet/WalletActionsRow';
import { WalletHeader } from '../../components/wallet/WalletHeader';
import { Screen } from '../../components/ui/Screen';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { useCurrentUser } from '../../stores/authStore';
import {
  useCoinBalance,
  useCoinExpiryDaysLeft,
  useCoinTransactions,
  useLifetimeEarned,
  useMonthlyCoinSummary,
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
 */
export const WalletScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const user = useCurrentUser();

  const balance = useCoinBalance();
  const lifetimeEarned = useLifetimeEarned();
  const transactions = useCoinTransactions();
  const summary = useMonthlyCoinSummary();
  const expiryDaysLeft = useCoinExpiryDaysLeft();

  const onOpenShop = useCallback(
    () => navigation.navigate('Main', { screen: 'Shop' }),
    [navigation],
  );

  const onOpenAccount = useCallback(
    () => navigation.navigate('Main', { screen: 'Account' }),
    [navigation],
  );

  // Destinations the app has not built yet — coin history, orders, the expiry
  // explainer. Wired as no-ops rather than left off, so the row keeps the shape
  // it will ship with and only the handler changes when each screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <WalletHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          hasUnreadNotifications
          onPressNotifications={notImplemented}
          onPressAvatar={onOpenAccount}
        />

        <CoinBalanceCard
          balance={balance}
          lifetimeEarned={lifetimeEarned}
          expiryDaysLeft={expiryDaysLeft}
          onPressAboutExpiry={notImplemented}
        />

        <WalletActionsRow
          onPressEarn={notImplemented}
          onPressShop={onOpenShop}
          onPressHistory={notImplemented}
          onPressOrders={notImplemented}
        />

        <KeepGoingCard />

        <RecentTransactionsCard
          transactions={transactions}
          onPressViewAll={notImplemented}
        />

        <CoinsSummaryCard
          earned={summary.earned}
          spent={summary.spent}
          net={summary.net}
        />
      </ScrollView>
    </Screen>
  );
};
