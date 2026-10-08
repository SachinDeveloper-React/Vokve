import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ArrowUpRight,
  CreditCard,
  Headphones,
  MapPin,
  PackageX,
  RotateCcw,
  Truck,
} from 'lucide-react-native';
import { AccountMenuRow } from '../../components/account/AccountMenuRow';
import { formatAddressLines } from '../../components/address/AddressCard';
import { deliverySummary } from '../../components/address/deliverySummary';
import { CheckoutCard } from '../../components/checkout/CheckoutCard';
import { CheckoutLineRow } from '../../components/checkout/CheckoutLineRow';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { useToast } from '../../components/feedback/Toast';
import { Divider } from '../../components/layout/Divider';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { OrderNumberRow } from '../../components/orders/OrderNumberRow';
import { OrderStatusPill } from '../../components/orders/OrderStatusPill';
import { OrderTimeline } from '../../components/orders/OrderTimeline';
import { OrderTrackerStrip } from '../../components/orders/OrderTrackerStrip';
import { orderTitle } from '../../components/orders/OrderCard';
import { PriceBreakdown } from '../../components/shop/PriceBreakdown';
import { ShopPageHeader } from '../../components/shop/ShopPageHeader';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { orderApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import { useCheckoutStore, useIsPaying } from '../../stores/checkoutStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useOrder, useOrdersStore } from '../../stores/ordersStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { withAlpha } from '../../utils/color';
import type { Order, OrderStatus } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';
import {
  formatClockTime,
  formatCoins,
  formatDayMonthYear,
  formatDayRange,
  formatMoney,
  formatRelativeDay,
} from '../../utils/format';

const makeStyles = ({ spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxl, gap: spacing.base },
    empty: { paddingVertical: spacing.xl },
    grow: { flex: 1 },
    half: { flex: 1 },
    /** The line under the tracker: where the parcel is, and the way to watch it. */
    banner: {
      borderRadius: radius.lg,
      borderWidth: 1,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.base,
    },
    pip: { width: 8, height: 8, borderRadius: 4 },
    link: { fontWeight: '600' },
  });

/** The stops are only worth drawing while the order is still on the path. */
const IN_FLIGHT: readonly OrderStatus[] = [
  'placed',
  'confirmed',
  'shipped',
  'delivered',
];

/** A delivery window is a promise about a parcel that has not arrived yet. */
const ON_ITS_WAY: readonly OrderStatus[] = ['placed', 'confirmed', 'shipped'];

/** How the money side reads on the receipt. */
const PAYMENT_COPY: Record<Order['payment']['status'], string> = {
  not_required: 'Paid in full with coins',
  pending: 'Payment pending',
  paid: 'Paid',
  failed: 'Payment failed',
  refunded: 'Refunded',
};

/**
 * One order, in full: where it stands, what is in it, where it is going,
 * everything that has happened to it, and — while it can still be stopped
 * — the way to stop it (RULES R5, R6).
 *
 * Every figure and every promise on this page is the server's: the stops
 * and their times come from the events it keeps, the delivery window from
 * what the order promised when it was placed, the courier's link from the
 * reference it was given, and the returns line from the shop's own policy.
 * The page is a renderer, so nothing here can promise a date the warehouse
 * never agreed to.
 *
 * It reads from the orders cache first, so opening from the list is
 * instant, and fetches the order itself for a deep link the cache has
 * never seen.
 */
export const OrderDetailScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'OrderDetail'>['route']>();
  const toast = useToast();
  const balance = useCoinBalance();

  const cached = useOrder(route.params.id);
  const [fetched, setFetched] = useState<Order | null>(null);
  const [isLoading, setLoading] = useState(cached === null);
  const order = cached ?? fetched;

  const cancel = useOrdersStore(s => s.cancel);
  const cancellingId = useOrdersStore(s => s.cancellingId);
  const isCancelling = cancellingId === route.params.id;
  const payPending = useCheckoutStore(s => s.payPending);
  const isPaying = useIsPaying();
  const [isConfirmOpen, setConfirmOpen] = useState(false);

  // A deep link lands here with an empty cache; the list is not fetched for
  // one row — the row is.
  useEffect(() => {
    if (cached !== null) {
      return;
    }
    let cancelled = false;
    orderApi
      .get(route.params.id)
      .then(result => {
        if (!cancelled) setFetched(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cached, route.params.id]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Orders');
  }, [navigation]);

  const openWallet = useCallback(
    () => navigation.navigate('Main', { screen: 'Wallet' }),
    [navigation],
  );
  const openHelp = useCallback(
    () => navigation.navigate('HelpSupport'),
    [navigation],
  );
  const changeAddress = useCallback(
    () =>
      navigation.navigate('Addresses', {
        select: true,
        orderId: route.params.id,
      }),
    [navigation, route.params.id],
  );
  const openConfirm = useCallback(() => setConfirmOpen(true), []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  /** The courier's own page, where the order has been given a reference. */
  const onTrackLive = useCallback(() => {
    if (!order?.trackingUrl) return;
    Linking.openURL(order.trackingUrl).catch(() =>
      toast.show({
        title: "Couldn't open tracking",
        message: 'The courier’s page could not be opened on this device.',
        tone: 'warning',
      }),
    );
  }, [order?.trackingUrl, toast]);

  const onCancel = useCallback(async () => {
    try {
      const result = await cancel(route.params.id);
      setFetched(result);
      toast.show({
        title: 'Order cancelled',
        message:
          result.coinsUsed > 0
            ? `${formatCoins(result.coinsUsed)} coins are back in your wallet${
                result.payment.status === 'refunded'
                  ? ', and the payment is being refunded'
                  : ''
              }.`
            : result.payment.status === 'refunded'
            ? 'The payment is being refunded.'
            : 'Nothing was charged.',
        tone: 'success',
      });
    } catch (error) {
      const apiError = toApiError(error);
      toast.show({
        title:
          apiError.code === 'ORDER_NOT_CANCELLABLE'
            ? 'Too late to cancel'
            : "Couldn't cancel",
        message: apiError.message,
        tone: 'warning',
      });
    }
  }, [cancel, route.params.id, toast]);

  const onPayNow = useCallback(async () => {
    if (!order) return;
    const outcome = await payPending(order);
    if (outcome.status === 'placed') {
      setFetched(outcome.order);
      toast.show({
        title: 'Payment received',
        message: `${formatMoney(
          outcome.order.payable,
          outcome.order.currency,
        )} paid. Your order is placed.`,
        tone: 'success',
      });
    } else if (outcome.status === 'payment_pending') {
      toast.show({
        title: 'Payment not completed',
        message:
          outcome.error?.message ??
          'The order is still waiting for its payment.',
        tone: 'info',
      });
    } else if (outcome.status === 'failed') {
      toast.show({
        title:
          outcome.error.code === 'PAYMENT_EXPIRED'
            ? 'Payment window closed'
            : "Couldn't take the payment",
        message: outcome.error.message,
        tone: 'error',
      });
      if (
        outcome.error.code === 'PAYMENT_EXPIRED' ||
        outcome.error.code === 'ORDER_NOT_PENDING'
      ) {
        orderApi
          .get(order.id)
          .then(setFetched)
          .catch(() => {});
      }
    }
  }, [order, payPending, toast]);

  const cancelActions = useMemo(
    () => [
      {
        label: 'Cancel this order',
        icon: PackageX,
        destructive: true,
        onPress: onCancel,
      },
    ],
    [onCancel],
  );

  /**
   * The banner takes the colour of the news it carries: green while the
   * order is on its way or has arrived, amber while it owes money, and the
   * muted grey of a closed thing once it is cancelled.
   */
  const tone =
    order === null || IN_FLIGHT.includes(order.status)
      ? colors.success
      : order.status === 'pending_payment'
      ? colors.warning
      : colors.textSecondary;

  /** The bill is only worth repeating when there is more to it than the lines. */
  const hasBill =
    order !== null &&
    (order.payable > 0 ||
      order.discount > 0 ||
      order.shipping > 0 ||
      order.coupon !== null);

  return (
    <Screen edges={['top']}>
      <ShopPageHeader
        title="Order Details"
        subtitle="Track your order and view details"
        balance={balance}
        onPressBack={onPressBack}
        onPressBalance={openWallet}
      />

      {!order ? (
        <View style={styles.empty}>
          {isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Card radius="xl">
              <EmptyState
                title="Couldn't find that order"
                message="It may have been placed from another account."
                actionLabel="Back to orders"
                onAction={onPressBack}
              />
            </Card>
          )}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Card radius="xl" padding="base">
            <VStack gap="base">
              <HStack align="start" justify="between" gap="md">
                <VStack gap="xxs">
                  <AppText variant="micro" color="textSecondary">
                    Order ID
                  </AppText>
                  <OrderNumberRow number={order.number} layout="stacked" />
                  <AppText variant="micro" color="textTertiary">
                    {`Placed on ${formatDayMonthYear(
                      order.placedAt,
                    )}, ${formatClockTime(order.placedAt)}`}
                  </AppText>
                </VStack>

                <VStack align="end" gap="xxs">
                  <OrderStatusPill status={order.status} />
                  {order.estimatedDelivery && ON_ITS_WAY.includes(order.status) ? (
                    <>
                      <AppText variant="miniMicro" color="textTertiary">
                        Expected by
                      </AppText>
                      <AppText
                        variant="bodyStrong"
                        style={{ color: colors.success }}
                      >
                        {formatDayRange(
                          order.estimatedDelivery.from,
                          order.estimatedDelivery.to,
                        )}
                      </AppText>
                    </>
                  ) : null}
                </VStack>
              </HStack>

              {IN_FLIGHT.includes(order.status) ? (
                <OrderTrackerStrip status={order.status} />
              ) : null}

              <HStack
                align="center"
                gap="sm"
                style={[
                  styles.banner,
                  {
                    backgroundColor: withAlpha(tone, isDark ? 0.14 : 0.08),
                    borderColor: withAlpha(tone, 0.3),
                  },
                ]}
              >
                <View style={[styles.pip, { backgroundColor: tone }]} />
                <AppText
                  variant="caption"
                  style={styles.grow}
                  numberOfLines={2}
                >
                  {order.headline}
                </AppText>
                {order.trackingUrl ? (
                  <AppText
                    variant="caption"
                    onPress={onTrackLive}
                    accessibilityRole="link"
                    style={[styles.link, { color: colors.brandAccent }]}
                  >
                    Track Live
                  </AppText>
                ) : null}
              </HStack>

              {order.trackingRef ? (
                <HStack align="center" gap="sm">
                  <Icon as={Truck} size="sm" color="textSecondary" />
                  <AppText variant="micro" color="textSecondary">
                    {`Tracking ${order.trackingRef}`}
                  </AppText>
                </HStack>
              ) : null}
            </VStack>
          </Card>

          <CheckoutCard title="Product Details">
            {order.items.map((line, index) => (
              <Fragment
                key={`${line.itemId}:${line.size ?? ''}:${line.color ?? ''}`}
              >
                {index > 0 ? <Divider /> : null}
                <CheckoutLineRow
                  line={{
                    title: line.title,
                    emoji: line.emoji,
                    image: line.image,
                    quantity: line.quantity,
                    size: line.size,
                    color: line.color,
                    lineTotal: line.price * line.quantity,
                    lineCoins: line.coinPrice * line.quantity,
                    coinsUsed: line.coinsUsed,
                    moneyPaid: line.moneyPaid,
                    inStock: true,
                  }}
                  currency={order.currency}
                  inCoins={order.inCoins !== null}
                  showSplit
                />
              </Fragment>
            ))}

            {hasBill ? (
              <>
                <Divider />
                <PriceBreakdown
                  figures={{
                    currency: order.currency,
                    mrpTotal: order.subtotal + order.discount,
                    discount: order.discount,
                    subtotal: order.subtotal,
                    shipping: order.shipping,
                    coinsApplied: order.coinsUsed,
                    coinsValue: order.coinsValue,
                    payable: order.payable,
                    coupon: order.coupon,
                    inCoins: order.inCoins,
                  }}
                  payableLabel={order.inCoins ? 'Paid in coins' : 'To pay'}
                />
                <HStack align="center" gap="sm">
                  <Icon
                    as={CreditCard}
                    size="sm"
                    tint={
                      order.payment.status === 'pending' ||
                      order.payment.status === 'failed'
                        ? colors.warning
                        : colors.success
                    }
                  />
                  <AppText
                    variant="micro"
                    color="textSecondary"
                    style={styles.grow}
                  >
                    {PAYMENT_COPY[order.payment.status]}
                    {order.payment.paidAt
                      ? ` · ${formatRelativeDay(
                          order.payment.paidAt,
                        )}, ${formatClockTime(order.payment.paidAt)}`
                      : ''}
                    {order.status === 'pending_payment' &&
                    order.payment.expiresAt
                      ? ` · pay by ${formatClockTime(order.payment.expiresAt)}`
                      : ''}
                  </AppText>
                </HStack>
              </>
            ) : null}

            {order.status === 'pending_payment' ? (
              <Button
                label={`Pay ${formatMoney(order.payable, order.currency)} now`}
                variant="brand"
                fullWidth
                loading={isPaying}
                disabled={isPaying || isCancelling}
                onPress={onPayNow}
              />
            ) : null}
          </CheckoutCard>

          <CheckoutCard
            title="Delivery Address"
            icon={MapPin}
            action={
              order.addressChangeable
                ? {
                    label: 'Change',
                    onPress: changeAddress,
                    accessibilityLabel: 'Change the delivery address',
                  }
                : undefined
            }
          >
            <VStack gap="xxs">
              <AppText variant="bodyStrong">{order.address.name}</AppText>
              {formatAddressLines(order.address).map(line => (
                <AppText key={line} variant="caption" color="textSecondary">
                  {line}
                </AppText>
              ))}
              {deliverySummary(order.delivery) ? (
                <AppText variant="micro" color="textTertiary">
                  {deliverySummary(order.delivery)}
                </AppText>
              ) : null}
            </VStack>
          </CheckoutCard>

          <CheckoutCard title="Order Timeline">
            <OrderTimeline
              entries={order.timeline}
              estimatedDelivery={order.estimatedDelivery}
            />
          </CheckoutCard>

          <HStack gap="md">
            <View style={styles.half}>
              <Button
                label="Need Help?"
                variant="brandOutline"
                size="lg"
                fullWidth
                onPress={openHelp}
                icon={
                  <Icon as={Headphones} size="sm" tint={colors.brandAccent} />
                }
              />
            </View>
            {order.trackingUrl ? (
              <View style={styles.half}>
                <Button
                  label="Track Live"
                  variant="brand"
                  size="lg"
                  fullWidth
                  onPress={onTrackLive}
                  iconPosition="trailing"
                  icon={
                    <Icon
                      as={ArrowUpRight}
                      size="sm"
                      tint={colors.primaryForeground}
                    />
                  }
                />
              </View>
            ) : null}
          </HStack>

          {order.cancellable ? (
            <Button
              label="Cancel order"
              variant="destructive"
              fullWidth
              loading={isCancelling}
              disabled={isCancelling}
              onPress={openConfirm}
            />
          ) : null}

          {order.returns ? (
            <Card radius="xl" padding="base">
              <AccountMenuRow
                icon={RotateCcw}
                tint={colors.brandAccent}
                title="Returns & Replacements"
                subtitle={order.returns.note}
                onPress={openHelp}
              />
            </Card>
          ) : null}
        </ScrollView>
      )}

      <ActionSheet
        visible={isConfirmOpen}
        onClose={closeConfirm}
        title={order ? `Cancel ${orderTitle(order)}?` : 'Cancel order?'}
        message={
          order
            ? order.coinsUsed > 0
              ? `${formatCoins(
                  order.coinsUsed,
                )} coins go straight back to your wallet${
                  order.payment.status === 'paid'
                    ? ', and the payment is refunded'
                    : ''
                }. This cannot be undone.`
              : order.payment.status === 'paid'
              ? 'The payment is refunded. This cannot be undone.'
              : 'Nothing has been charged. This cannot be undone.'
            : undefined
        }
        actions={cancelActions}
        cancelLabel="Keep the order"
      />
    </Screen>
  );
};
