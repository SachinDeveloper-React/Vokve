import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Check,
  ChevronRight,
  Clock,
  Gift,
  MapPin,
  PackageX,
  Truck,
  type LucideIcon,
} from 'lucide-react-native';
import { formatAddressLines } from '../../components/address/AddressCard';
import { deliverySummary } from '../../components/address/deliverySummary';
import { CheckoutCard } from '../../components/checkout/CheckoutCard';
import { CheckoutLineRow } from '../../components/checkout/CheckoutLineRow';
import { useToast } from '../../components/feedback/Toast';
import { Divider } from '../../components/layout/Divider';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { OrderOutcomeHeader } from '../../components/orders/OrderOutcomeHeader';
import { OrderTrackerStrip } from '../../components/orders/OrderTrackerStrip';
import { CoinBalancePill } from '../../components/shop/CoinBalancePill';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { Pressable } from '../../components/form/Pressable';
import { orderApi } from '../../services/api/endpoints';
import { useCheckoutStore, useIsPaying } from '../../stores/checkoutStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useOrder } from '../../stores/ordersStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { Order } from '../../types/models';
import type {
  RootStackParamList,
  RootStackScreenProps,
} from '../../types/navigation';
import { withAlpha } from '../../utils/color';
import {
  formatClockTime,
  formatDayMonthYear,
  formatDayRange,
} from '../../utils/format';

/** What each channel is called in the line that promises them. */
const CHANNEL_LABEL: Record<Order['trackingChannels'][number], string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
};

interface Outcome {
  icon: LucideIcon;
  tint: string;
  title: string;
  message: string;
  /** Whether the four stops to the door are worth drawing. */
  showTracker: boolean;
}

const makeStyles = ({ spacing, colors, radius }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxl, gap: spacing.base },
    header: { paddingTop: spacing.sm },
    empty: { paddingVertical: spacing.xl },
    grow: { flex: 1 },
    reward: {
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.base,
    },
    badge: {
      width: 36,
      height: 36,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

/**
 * What came of the order, the moment it was placed (RULES R5, R12).
 *
 * The till hands over to this page rather than to the receipt: a member
 * who has just spent coins they walked for wants the verdict, the
 * reference, and when it arrives — not the arithmetic again. The receipt
 * is one tap away under "Track Your Order".
 *
 * Every state the checkout can end in is worded here, not just the happy
 * one: an order still owing money says so and offers to collect it, and
 * one that was cancelled says that. The reference, the window and the
 * channels it promises are all the server's, so the page never invents a
 * delivery date or promises an SMS nobody can send.
 */
export const OrderConfirmationScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RootStackScreenProps<'OrderConfirmation'>['route']>();
  const toast = useToast();
  const balance = useCoinBalance();

  const cached = useOrder(route.params.id);
  const [fetched, setFetched] = useState<Order | null>(null);
  const [isLoading, setLoading] = useState(cached === null);
  const order = cached ?? fetched;

  const payPending = useCheckoutStore(s => s.payPending);
  const isPaying = useIsPaying();

  // Placed from here, the order is already in the cache; a deep link is not.
  useEffect(() => {
    if (cached !== null) return;
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

  const outcome = useMemo<Outcome | null>(() => {
    if (!order) return null;
    if (order.status === 'cancelled' || order.status === 'refunded') {
      return {
        icon: PackageX,
        tint: colors.textSecondary,
        title: 'Order Cancelled',
        message:
          order.coinsUsed > 0
            ? 'Your coins are back in your wallet.'
            : 'Anything you paid is on its way back.',
        showTracker: false,
      };
    }
    if (order.status === 'pending_payment') {
      return {
        icon: Clock,
        tint: colors.warning,
        title: 'Payment Pending',
        message:
          order.payment.status === 'failed'
            ? "That payment didn't go through. Your order is held — try again below."
            : 'Your order is saved and held. Pay for it before the window closes.',
        showTracker: false,
      };
    }
    return {
      icon: Check,
      tint: colors.success,
      title: 'Order Confirmed!',
      message: 'Thank you! Your order has been placed.',
      showTracker: true,
    };
  }, [colors, order]);

  const onPressWallet = useCallback(
    () => navigation.navigate('Main', { screen: 'Wallet' }),
    [navigation],
  );
  const onTrack = useCallback(
    () => navigation.replace('OrderDetail', { id: route.params.id }),
    [navigation, route.params.id],
  );
  const onShop = useCallback(
    () => navigation.navigate('Main', { screen: 'Shop' }),
    [navigation],
  );
  const onPay = useCallback(async () => {
    if (!order) return;
    const result = await payPending(order);
    if (result.status === 'failed') {
      toast.show({
        title: "Couldn't take the payment",
        message: result.error.message,
        tone: 'error',
      });
      return;
    }
    if (result.status === 'payment_pending') {
      toast.show({
        title: 'Still waiting for payment',
        message:
          result.error?.message ?? 'Pay before the window closes to keep it.',
        tone: 'warning',
      });
      return;
    }
    if (result.status === 'placed') {
      // The store has the paid order; this is for the deep-link case, where
      // the page is reading its own copy rather than the cache's.
      setFetched(result.order);
    }
  }, [order, payPending, toast]);

  return (
    <Screen edges={['top']}>
      <HStack justify="end" style={styles.header}>
        <CoinBalancePill balance={balance} onPress={onPressWallet} />
      </HStack>

      {!order || !outcome ? (
        <View style={styles.empty}>
          {isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Card radius="xl">
              <EmptyState
                title="Couldn't find that order"
                message="It may have been removed."
                actionLabel="Back to the shop"
                onAction={onShop}
              />
            </Card>
          )}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <OrderOutcomeHeader
            icon={outcome.icon}
            tint={outcome.tint}
            title={outcome.title}
            message={outcome.message}
          />

          <Card radius="xl" padding="base">
            <VStack gap="md">
              <HStack align="start" justify="between" gap="md">
                <VStack gap="xxs">
                  <AppText variant="label" color="textSecondary">
                    Order ID
                  </AppText>
                  <AppText variant="h3">{`#${order.number}`}</AppText>
                </VStack>
                <VStack gap="xxs" align="end">
                  <AppText variant="label" color="textSecondary">
                    Order Date
                  </AppText>
                  <AppText variant="bodyStrong">
                    {`${formatDayMonthYear(order.placedAt)}, ${formatClockTime(
                      order.placedAt,
                    )}`}
                  </AppText>
                </VStack>
              </HStack>

              {order.items.map((item, index) => (
                <React.Fragment
                  key={`${item.itemId}:${item.size ?? ''}:${item.color ?? ''}`}
                >
                  {index > 0 ? <Divider /> : null}
                  <CheckoutLineRow
                    line={{
                      title: item.title,
                      emoji: item.emoji,
                      image: item.image,
                      quantity: item.quantity,
                      size: item.size,
                      color: item.color,
                      lineTotal: item.price * item.quantity,
                      lineCoins: item.coinPrice * item.quantity,
                      coinsUsed: item.coinsUsed,
                      moneyPaid: item.moneyPaid,
                      inStock: true,
                    }}
                    currency={order.currency}
                    inCoins={order.inCoins !== null}
                    showSplit
                  />
                </React.Fragment>
              ))}
            </VStack>
          </Card>

          <CheckoutCard title="Delivery Address" icon={MapPin}>
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

          {outcome.showTracker ? (
            <CheckoutCard title="Estimated Delivery" icon={Truck}>
              <VStack gap="xs">
                {order.estimatedDelivery ? (
                  <AppText variant="h3" style={{ color: colors.success }}>
                    {formatDayRange(
                      order.estimatedDelivery.from,
                      order.estimatedDelivery.to,
                    )}
                  </AppText>
                ) : null}
                {order.trackingChannels.length > 0 ? (
                  <AppText variant="micro" color="textTertiary">
                    {`You will receive tracking details via ${order.trackingChannels
                      .map(channel => CHANNEL_LABEL[channel])
                      .join('/')}.`}
                  </AppText>
                ) : null}
              </VStack>
              <OrderTrackerStrip status={order.status} />
            </CheckoutCard>
          ) : null}

          {order.status === 'pending_payment' ? (
            <Button
              label="Pay Now"
              variant="brand"
              size="lg"
              fullWidth
              loading={isPaying}
              disabled={isPaying}
              onPress={onPay}
            />
          ) : (
            <Button
              label="Track Your Order"
              variant="brand"
              size="lg"
              fullWidth
              onPress={onTrack}
              iconPosition="trailing"
              icon={
                <Icon
                  as={ChevronRight}
                  size="sm"
                  tint={colors.primaryForeground}
                />
              }
            />
          )}

          <Button
            label="Continue Shopping"
            variant="brandOutline"
            size="lg"
            fullWidth
            onPress={onShop}
          />

          <Pressable
            onPress={onPressWallet}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel="Keep walking, keep earning. Open your wallet"
          >
            <HStack align="center" gap="md" style={styles.reward}>
              <HStack
                align="center"
                justify="center"
                style={[
                  styles.badge,
                  {
                    backgroundColor: withAlpha(
                      colors.gold,
                      isDark ? 0.18 : 0.1,
                    ),
                  },
                ]}
              >
                <Icon as={Gift} size="md" tint={colors.gold} />
              </HStack>
              <VStack flex={1} gap="xxs">
                <AppText variant="bodyStrong">
                  Keep walking, keep earning!
                </AppText>
                <AppText variant="micro" color="textSecondary">
                  Use your coins for more exciting rewards.
                </AppText>
              </VStack>
              <Icon as={ChevronRight} size="sm" color="textSecondary" />
            </HStack>
          </Pressable>
        </ScrollView>
      )}
    </Screen>
  );
};
