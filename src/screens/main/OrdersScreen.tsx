import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import { MapPin } from 'lucide-react-native';
import { AccountMenuRow } from '../../components/account/AccountMenuRow';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { OrderCard } from '../../components/orders/OrderCard';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useAuthStatus } from '../../stores/authStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useOrders, useOrdersStore } from '../../stores/ordersStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { Order } from '../../types/models';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl },
    header: { paddingBottom: spacing.md },
    separator: { height: spacing.md },
    footer: { paddingVertical: spacing.lg, alignItems: 'center' },
    empty: { paddingVertical: spacing.xl },
    addresses: { marginTop: spacing.md },
  });

const END_REACHED_THRESHOLD = 0.4;

/**
 * Every reward the user has redeemed, newest first (RULES R5–R7).
 *
 * A root route reached from three places — the wallet's tile, the shop's
 * bag, the account's menu — so it belongs to no tab and the chevron hands
 * the user back to whichever they came from. The address book is offered at
 * the bottom because this is where a user who wants to change where the
 * next order goes will come looking.
 */
export const OrdersScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const balance = useCoinBalance();
  const orders = useOrders();
  const isSyncing = useOrdersStore(s => s.isSyncing);
  const isLoadingMore = useOrdersStore(s => s.isLoadingMore);
  const syncedAt = useOrdersStore(s => s.syncedAt);
  const hydrateFromServer = useOrdersStore(s => s.hydrateFromServer);
  const refreshIfStale = useOrdersStore(s => s.refreshIfStale);
  const loadMore = useOrdersStore(s => s.loadMore);
  const isSignedIn = useAuthStatus() === 'authenticated';

  useEffect(() => {
    if (isSignedIn) {
      refreshIfStale();
    }
  }, [isSignedIn, refreshIfStale]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Wallet' });
  }, [navigation]);

  const openOrder = useCallback(
    (id: string) => navigation.navigate('OrderDetail', { id }),
    [navigation],
  );
  const openShop = useCallback(
    () => navigation.navigate('Main', { screen: 'Shop' }),
    [navigation],
  );
  const openAddresses = useCallback(
    () => navigation.navigate('Addresses'),
    [navigation],
  );

  const renderItem = useCallback<ListRenderItem<Order>>(
    ({ item }) => <OrderCard order={item} onPress={openOrder} />,
    [openOrder],
  );
  const keyExtractor = useCallback((order: Order) => order.id, []);
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
          title="My Orders"
          subtitle="Rewards you have redeemed"
        />
      </View>
    ),
    [balance, onPressBack, styles.header],
  );

  const empty = useMemo(() => {
    if (isSyncing && syncedAt === null) {
      return (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    return (
      <Card radius="xl" style={styles.empty}>
        <EmptyState
          title="No orders yet"
          message="Redeem a reward in the shop and it will show up here, with its delivery status."
          actionLabel="Browse the shop"
          onAction={openShop}
        />
      </Card>
    );
  }, [colors.primary, isSyncing, openShop, styles.empty, syncedAt]);

  const footer = useMemo(
    () => (
      <>
        {isLoadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}
        <Card radius="xl" padding="base" style={styles.addresses}>
          <AccountMenuRow
            icon={MapPin}
            tint={colors.primary}
            title="Shipping addresses"
            subtitle="Where your rewards are sent"
            onPress={openAddresses}
          />
        </Card>
      </>
    ),
    [
      colors.primary,
      isLoadingMore,
      openAddresses,
      styles.addresses,
      styles.footer,
    ],
  );

  return (
    <Screen edges={['top']}>
      <FlashList
        data={orders}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ItemSeparatorComponent={separator}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={loadMore}
        onEndReachedThreshold={END_REACHED_THRESHOLD}
        refreshControl={
          <RefreshControl
            refreshing={isSyncing && syncedAt !== null}
            onRefresh={hydrateFromServer}
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
