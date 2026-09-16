import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MapPin, PackageX, Truck } from 'lucide-react-native';
import { formatAddressLines } from '../../components/address/AddressCard';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { useToast } from '../../components/feedback/Toast';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { Divider } from '../../components/layout/Divider';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { Emoji } from '../../components/media/Emoji';
import { OrderStatusPill } from '../../components/orders/OrderStatusPill';
import { orderTitle } from '../../components/orders/OrderCard';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { CoinAmount } from '../../components/wallet/CoinAmount';
import { orderApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import { useCoinBalance } from '../../stores/coinsStore';
import { useOrder, useOrdersStore } from '../../stores/ordersStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { Order, OrderStatus } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';
import { formatClockTime, formatRelativeDay } from '../../utils/format';

const makeStyles = ({ spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    empty: { paddingVertical: spacing.xl },
    /** The line between two stops on the journey; fills whatever the labels leave. */
    track: { flex: 1, height: 3, borderRadius: radius.pill },
  });

/**
 * The states an order passes through on its way to the door (RULES R5), in
 * order, so the timeline can mark how far along this one is. Cancelled and
 * refunded step off the path and are shown as the end instead.
 */
const JOURNEY: readonly OrderStatus[] = [
  'placed',
  'confirmed',
  'shipped',
  'delivered',
];

const JOURNEY_COPY: Record<OrderStatus, string> = {
  placed: 'We have your order and are getting it ready.',
  confirmed: 'Confirmed and being packed.',
  shipped: 'On its way with the courier.',
  delivered: 'Delivered. Enjoy it!',
  cancelled: 'Cancelled. The coins are back in your wallet.',
  refunded: 'Refunded by our support team.',
};

/**
 * One order, in full: the items, where it is going, where it stands, and —
 * while it can still be stopped — the way to stop it (RULES R5, R6).
 *
 * Reads from the orders cache first, so opening from the list is instant,
 * and fetches the order itself for a deep link the cache has never seen.
 */
export const OrderDetailScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
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

  const openConfirm = useCallback(() => setConfirmOpen(true), []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  const onCancel = useCallback(async () => {
    try {
      const result = await cancel(route.params.id);
      setFetched(result);
      toast.show({
        title: 'Order cancelled',
        message: `${result.totalCoins} coins are back in your wallet.`,
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

  const reachedIndex = order ? JOURNEY.indexOf(order.status) : -1;
  const offPath = order?.status === 'cancelled' || order?.status === 'refunded';

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title="Order"
          subtitle={order ? `Placed ${formatRelativeDay(order.placedAt)}` : ' '}
        />

        {!order ? (
          <Card radius="xl" style={styles.empty}>
            <EmptyState
              title={
                isLoading ? 'Loading your order' : "Couldn't find that order"
              }
              message={
                isLoading
                  ? 'One moment.'
                  : 'It may have been placed from another account.'
              }
              actionLabel={isLoading ? undefined : 'Back to orders'}
              onAction={isLoading ? undefined : onPressBack}
            />
          </Card>
        ) : (
          <>
            <Card radius="xl" padding="base">
              <VStack gap="md">
                <HStack align="center" justify="between" gap="sm">
                  <AppText variant="label" color="textSecondary">
                    Status
                  </AppText>
                  <OrderStatusPill status={order.status} />
                </HStack>

                <AppText variant="body">{JOURNEY_COPY[order.status]}</AppText>

                {!offPath ? (
                  <HStack align="center" gap="xs">
                    {JOURNEY.map((step, index) => (
                      <Fragment key={step}>
                        {index > 0 ? (
                          <View
                            style={[
                              styles.track,
                              {
                                backgroundColor:
                                  index <= reachedIndex
                                    ? colors.primary
                                    : colors.border,
                              },
                            ]}
                          />
                        ) : null}
                        <AppText
                          variant="miniMicro"
                          style={{
                            color:
                              index <= reachedIndex
                                ? colors.primary
                                : colors.textTertiary,
                          }}
                        >
                          {step.charAt(0).toUpperCase() + step.slice(1)}
                        </AppText>
                      </Fragment>
                    ))}
                  </HStack>
                ) : null}

                {order.trackingRef ? (
                  <HStack align="center" gap="sm">
                    <Icon as={Truck} size="sm" color="textSecondary" />
                    <AppText variant="caption" color="textSecondary">
                      {`Tracking ${order.trackingRef}`}
                    </AppText>
                  </HStack>
                ) : null}

                <AppText variant="micro" color="textTertiary">
                  {`Updated ${formatRelativeDay(
                    order.updatedAt,
                  )}, ${formatClockTime(order.updatedAt)}`}
                </AppText>
              </VStack>
            </Card>

            <Card radius="xl" padding="base">
              <VStack gap="md">
                <AppText variant="label" color="textSecondary">
                  Items
                </AppText>
                {order.items.map((line, index) => (
                  <Fragment key={`${line.itemId}-${index}`}>
                    {index > 0 ? <Divider /> : null}
                    <HStack align="center" gap="md">
                      <Emoji size={moderateScale(28)} label={line.title}>
                        {line.emoji}
                      </Emoji>
                      <VStack flex={1} gap="xxs">
                        <AppText variant="bodyStrong">{line.title}</AppText>
                        <AppText variant="micro" color="textTertiary">
                          {`Qty ${line.quantity}`}
                        </AppText>
                      </VStack>
                      <CoinAmount
                        amount={line.priceCoins * line.quantity}
                        size="sm"
                      />
                    </HStack>
                  </Fragment>
                ))}
                <Divider />
                <HStack align="center" justify="between">
                  <AppText variant="bodyStrong">Total</AppText>
                  <CoinAmount amount={order.totalCoins} size="md" />
                </HStack>
              </VStack>
            </Card>

            <Card radius="xl" padding="base">
              <HStack align="start" gap="md">
                <Icon as={MapPin} size="lg" tint={colors.primary} />
                <VStack flex={1} gap="xxs">
                  <AppText variant="label" color="textSecondary">
                    {`Deliver to · ${order.address.label}`}
                  </AppText>
                  <AppText variant="body">{order.address.name}</AppText>
                  {formatAddressLines(order.address).map(line => (
                    <AppText key={line} variant="caption" color="textSecondary">
                      {line}
                    </AppText>
                  ))}
                </VStack>
              </HStack>
            </Card>

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
          </>
        )}
      </ScrollView>

      <ActionSheet
        visible={isConfirmOpen}
        onClose={closeConfirm}
        title={order ? `Cancel ${orderTitle(order)}?` : 'Cancel order?'}
        message={
          order
            ? `${order.totalCoins} coins go straight back to your wallet. This cannot be undone.`
            : undefined
        }
        actions={cancelActions}
        cancelLabel="Keep the order"
      />
    </Screen>
  );
};
