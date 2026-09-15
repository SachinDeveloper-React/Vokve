import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { useNavigation, useRoute } from '@react-navigation/native';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { VStack } from '../../components/layout/Stack';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import {
  CoinDayGroupCard,
  type CoinDayGroup,
} from '../../components/wallet/CoinDayGroupCard';
import type { CoinSourceFilter } from '../../components/wallet/CoinSourceFilterChip';
import { CoinSourceFilters } from '../../components/wallet/CoinSourceFilters';
import {
  groupCoinTransactionsByDay,
  useCoinHistory,
} from '../../hooks/useCoinHistory';
import { useCoinBalance } from '../../stores/coinsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl },
    header: { gap: spacing.md, paddingBottom: spacing.md },
    separator: { height: spacing.md },
    footer: {
      paddingVertical: spacing.lg,
      alignItems: 'center',
      gap: spacing.sm,
    },
    empty: { paddingVertical: spacing.xxl },
  });

/**
 * How far from the bottom, as a fraction of the visible length, the next page
 * is asked for. Early enough that a steady scroll never reaches the end of
 * what is loaded, late enough that opening the screen does not fetch three
 * pages the user will never look at.
 */
const END_REACHED_THRESHOLD = 0.4;

/**
 * The whole coin ledger, newest first, in day sections.
 *
 * The wallet shows four rows; this is what "View All" leads to. It pages from
 * the server rather than reading the coin store, because the store keeps
 * fifty rows for the wallet's glance and a history that stopped at fifty
 * would be the wallet's card again with more scrolling.
 *
 * The filter is screen state, as the notification centre's is: a way of
 * looking at the ledger, not a fact about it, and one that should not greet
 * the user next time with a list missing rows for no visible reason.
 *
 * A root route, pushed over the tab bar from the wallet, so the chevron hands
 * the user straight back to the wallet they came from.
 */
export const CoinHistoryScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'CoinHistory'>['route']>();

  const [source, setSource] = useState<CoinSourceFilter>(
    route.params?.source ?? null,
  );
  const balance = useCoinBalance();
  const history = useCoinHistory(source);

  const groups = useMemo(
    () => groupCoinTransactionsByDay(history.transactions),
    [history.transactions],
  );

  // A notification could open the app straight onto this screen one day, and
  // `goBack` with nothing behind it is silently a no-op. The wallet is what
  // this screen is a page of, so that is where the fallback lands.
  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Wallet' });
  }, [navigation]);

  const renderItem = useCallback<ListRenderItem<CoinDayGroup>>(
    ({ item }) => <CoinDayGroupCard group={item} />,
    [],
  );
  const keyExtractor = useCallback((group: CoinDayGroup) => group.date, []);
  const separator = useCallback(
    () => <View style={styles.separator} />,
    [styles.separator],
  );

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title="Coin History"
          subtitle="Every coin earned and spent"
        />
        <CoinSourceFilters value={source} onChange={setSource} />
      </View>
    ),
    [balance, onPressBack, source, styles.header],
  );

  /**
   * What stands in for the list while it has no rows: a spinner while the
   * first page is on its way, the failure with a retry when it did not
   * arrive, and otherwise the honest "nothing here" — worded for the filter,
   * so an empty refunds list does not tell a user with coins that they have
   * none.
   */
  const empty = useMemo(() => {
    if (history.isLoading) {
      return (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (history.error) {
      return (
        <View style={styles.empty}>
          <EmptyState
            title="Couldn't load your history"
            message={history.error}
            actionLabel="Try again"
            onAction={history.retry}
          />
        </View>
      );
    }
    return (
      <View style={styles.empty}>
        <EmptyState
          title={source ? 'Nothing here yet' : 'No coins yet'}
          message={
            source
              ? 'No coins have moved from this source so far.'
              : 'Walk, train and keep your streak alive — every one of them pays out in coins.'
          }
        />
      </View>
    );
  }, [
    colors.primary,
    history.error,
    history.isLoading,
    history.retry,
    source,
    styles.empty,
  ]);

  /**
   * Under the last loaded day: the next page's spinner, or the reason it did
   * not come with a retry. A failed page must not look like the end of the
   * ledger — that is a balance the history no longer explains.
   */
  const footer = useMemo(() => {
    if (history.isLoadingMore) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (history.error && history.transactions.length > 0) {
      return (
        <VStack style={styles.footer}>
          <AppText variant="caption" color="textSecondary" center>
            {history.error}
          </AppText>
          <Button
            label="Try again"
            variant="secondary"
            size="sm"
            onPress={history.retry}
          />
        </VStack>
      );
    }
    return null;
  }, [
    colors.primary,
    history.error,
    history.isLoadingMore,
    history.retry,
    history.transactions.length,
    styles.footer,
  ]);

  return (
    <Screen edges={['top']}>
      <FlashList
        data={groups}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ItemSeparatorComponent={separator}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={history.loadMore}
        onEndReachedThreshold={END_REACHED_THRESHOLD}
        refreshControl={
          <RefreshControl
            refreshing={history.isRefreshing}
            onRefresh={history.refresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
};
