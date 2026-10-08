import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, StyleSheet, View } from 'react-native';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import { Gift, MapPin } from 'lucide-react-native';
import { AccountMenuRow } from '../../components/account/AccountMenuRow';
import { useToast } from '../../components/feedback/Toast';
import { OrderCard, type OrderAction } from '../../components/orders/OrderCard';
import { OrderFilterTabs } from '../../components/orders/OrderFilterTabs';
import { ShopPageHeader } from '../../components/shop/ShopPageHeader';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useCoinBalance } from '../../stores/coinsStore';
import { useOrderTab, useOrdersStore } from '../../stores/ordersStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { Order, OrderFilter } from '../../types/models';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl },
    tabs: { paddingBottom: spacing.base },
    separator: { height: spacing.md },
    footer: { paddingVertical: spacing.lg, alignItems: 'center' },
    empty: { paddingVertical: spacing.xl },
    rows: { marginTop: spacing.md },
  });

const END_REACHED_THRESHOLD = 0.4;

/** What an empty tab says — a filter that found nothing is not "no orders". */
const EMPTY_COPY: Record<OrderFilter, { title: string; message: string }> = {
  all: {
    title: 'No orders yet',
    message:
      'Redeem a reward in the shop and it will show up here, with its delivery status.',
  },
  processing: {
    title: 'Nothing being prepared',
    message: 'Orders being packed for you will show up here.',
  },
  shipped: {
    title: 'Nothing on the way',
    message: 'Once a parcel is with the courier you can track it here.',
  },
  delivered: {
    title: 'Nothing delivered yet',
    message: 'Orders that have reached you will be kept here.',
  },
  cancelled: {
    title: 'Nothing cancelled',
    message: 'Cancelled and refunded orders are kept here.',
  },
};

/**
 * Every reward the user has redeemed, newest first (RULES R5–R7).
 *
 * A root route reached from three places — the wallet's tile, the shop's
 * bag, the account's menu — so it belongs to no tab and the chevron hands
 * the user back to whichever they came from.
 *
 * The tabs page separately on the server rather than sieving one list
 * here: a member looking for a cancellation from March should not have to
 * scroll every delivered order since to find it. The address book is
 * offered at the bottom because this is where a user who wants to change
 * where the next order goes will come looking.
 */
export const OrdersScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const toast = useToast();
  const balance = useCoinBalance();

  const [filter, setFilter] = useState<OrderFilter>('all');
  const tab = useOrderTab(filter);
  const hydrateFromServer = useOrdersStore(s => s.hydrateFromServer);
  const refreshIfStale = useOrdersStore(s => s.refreshIfStale);
  const loadMore = useOrdersStore(s => s.loadMore);
  const reorder = useOrdersStore(s => s.reorder);
  const reorderingId = useOrdersStore(s => s.reorderingId);

  const refresh = useCallback(() => refreshIfStale(filter), [
    filter,
    refreshIfStale,
  ]);
  useRefreshOnFocus(refresh);

  /**
   * Each tab holds its own page, so moving to one asks for it — unless it
   * was read within the last minute, which the store decides.
   */
  const onChangeFilter = useCallback(
    (next: OrderFilter) => {
      setFilter(next);
      refreshIfStale(next);
    },
    [refreshIfStale],
  );

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
  const openWallet = useCallback(
    () => navigation.navigate('Main', { screen: 'Wallet' }),
    [navigation],
  );
  const openAddresses = useCallback(
    () => navigation.navigate('Addresses'),
    [navigation],
  );

  const onRefresh = useCallback(
    () => hydrateFromServer(filter),
    [filter, hydrateFromServer],
  );
  const onEndReached = useCallback(() => loadMore(filter), [filter, loadMore]);

  /**
   * The row's own button. Tracking opens the courier's page where there is
   * one — and the order itself where there is not, rather than a dead tap —
   * and buying again hands the whole order to the basket in one call, so a
   * three-line order is three lines back in the basket.
   */
  const onAction = useCallback(
    async (order: Order, action: OrderAction) => {
      if (action === 'track') {
        if (order.trackingUrl) {
          Linking.openURL(order.trackingUrl).catch(() => openOrder(order.id));
          return;
        }
        openOrder(order.id);
        return;
      }
      if (action !== 'buy_again') {
        openOrder(order.id);
        return;
      }
      try {
        const result = await reorder(order.id);
        if (result.added === 0) {
          toast.show({
            title: "Couldn't buy that again",
            message:
              result.skipped[0]?.reason ??
              'Nothing from that order is still on sale.',
            tone: 'warning',
          });
          return;
        }
        toast.show({
          title: 'Back in your cart',
          message:
            result.skipped.length > 0
              ? `${result.added} of ${
                  result.added + result.skipped.length
                } items — ${result.skipped[0].title} is no longer on sale.`
              : `${result.added} item${result.added > 1 ? 's' : ''} from ${
                  order.number
                }.`,
          tone: result.skipped.length > 0 ? 'info' : 'success',
          action: { label: 'View cart', onPress: () => navigation.navigate('Cart') },
        });
      } catch (error) {
        toast.show({
          title: "Couldn't buy that again",
          message: (error as { message: string }).message,
          tone: 'warning',
        });
      }
    },
    [navigation, openOrder, reorder, toast],
  );

  const renderItem = useCallback<ListRenderItem<Order>>(
    ({ item }) => (
      <OrderCard
        order={item}
        onPress={openOrder}
        onAction={onAction}
        busy={reorderingId === item.id}
      />
    ),
    [onAction, openOrder, reorderingId],
  );
  const keyExtractor = useCallback((order: Order) => order.id, []);
  const separator = useCallback(
    () => <View style={styles.separator} />,
    [styles.separator],
  );

  const empty = useMemo(() => {
    if (tab.isSyncing && tab.syncedAt === null) {
      return (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    return (
      <Card radius="xl" style={styles.empty}>
        <EmptyState
          title={EMPTY_COPY[filter].title}
          message={EMPTY_COPY[filter].message}
          actionLabel="Browse the shop"
          onAction={openShop}
        />
      </Card>
    );
  }, [colors.primary, filter, openShop, styles.empty, tab.isSyncing, tab.syncedAt]);

  const footer = useMemo(
    () => (
      <>
        {tab.isLoadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}
        <Card radius="xl" padding="base" style={styles.rows}>
          <AccountMenuRow
            icon={Gift}
            tint={colors.brandAccent}
            title="Shop More. Earn More."
            subtitle="Use your coins to get exciting fitness rewards."
            onPress={openShop}
          />
        </Card>
        <Card radius="xl" padding="base" style={styles.rows}>
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
      colors.brandAccent,
      colors.primary,
      openAddresses,
      openShop,
      styles.footer,
      styles.rows,
      tab.isLoadingMore,
    ],
  );

  return (
    <Screen edges={['top']}>
      <ShopPageHeader
        title="My Orders"
        subtitle="Track, manage and view all your orders"
        balance={balance}
        onPressBack={onPressBack}
        onPressBalance={openWallet}
      />
      {/* Pinned rather than scrolled with the rows: the tabs are how a
          member gets out of a long list, so they cannot be at the top of it. */}
      <View style={styles.tabs}>
        <OrderFilterTabs value={filter} onChange={onChangeFilter} />
      </View>
      <FlashList
        data={tab.orders}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ItemSeparatorComponent={separator}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={onEndReached}
        onEndReachedThreshold={END_REACHED_THRESHOLD}
        refreshControl={
          <RefreshControl
            refreshing={tab.isSyncing && tab.syncedAt !== null}
            onRefresh={onRefresh}
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
