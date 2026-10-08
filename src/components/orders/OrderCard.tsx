import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { Order, OrderStatus } from '../../types/models';
import { formatClockTime, formatDayMonthYear } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppImage } from '../media/AppImage';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { PayAmount } from '../shop/PayAmount';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { OrderNumberRow } from './OrderNumberRow';
import { OrderStatusPill } from './OrderStatusPill';
import { OrderTrackerStrip } from './OrderTrackerStrip';

const ART = moderateScale(72);

/** What the card calls the order: its one line, or the first with a count. */
export function orderTitle(order: Order): string {
  const [first] = order.items;
  if (!first) return 'Order';
  const more = order.items.length - 1;
  const unit =
    first.quantity > 1 ? `${first.title} × ${first.quantity}` : first.title;
  return more > 0 ? `${unit} + ${more} more` : unit;
}

/** What the one button on a row does, which is whatever the order needs next. */
export type OrderAction = 'track' | 'buy_again' | 'pay' | 'view';

/**
 * The action each state earns (RULES R5). A parcel in the world is worth
 * tracking, a delivered one is worth buying again, an unpaid one is worth
 * paying for; everything else only wants opening.
 */
const ACTION: Record<OrderStatus, { kind: OrderAction; label: string }> = {
  pending_payment: { kind: 'pay', label: 'Pay Now' },
  placed: { kind: 'view', label: 'View Details' },
  confirmed: { kind: 'view', label: 'View Details' },
  shipped: { kind: 'track', label: 'Track Order' },
  delivered: { kind: 'buy_again', label: 'Buy Again' },
  cancelled: { kind: 'buy_again', label: 'Buy Again' },
  refunded: { kind: 'view', label: 'View Details' },
};

/** The stops are only worth drawing while the parcel is still on its way. */
const IN_FLIGHT: readonly OrderStatus[] = [
  'placed',
  'confirmed',
  'shipped',
  'delivered',
];

interface Props {
  order: Order;
  onPress: (id: string) => void;
  /** The row's button, when it is not simply "open this order". */
  onAction?: (order: Order, action: OrderAction) => void;
  /** That button's spinner, while the write it starts is in flight. */
  busy?: boolean;
}

const makeStyles = ({ colors, radius }: ThemeShape) =>
  StyleSheet.create({
    art: {
      width: ART,
      height: ART,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    action: { minWidth: moderateScale(108) },
  });

/**
 * One order in the list: its reference, when it was placed, where it
 * stands, what is in it, what it cost, and the one thing worth doing with
 * it next (RULES R5).
 *
 * The reference leads rather than the product, because this list is read
 * with a support chat or a courier's message open beside it — "which of
 * these is VOK2509191234" is the question — and the pill answering "where
 * is it" sits on the same line. The stops below are drawn only while the
 * parcel is still coming: a cancelled order with a half-lit track would
 * read as one still on its way.
 */
export const OrderCard = memo(({ order, onPress, onAction, busy }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const handlePress = useCallback(() => onPress(order.id), [onPress, order.id]);
  const action = ACTION[order.status];
  const handleAction = useCallback(() => {
    if (action.kind === 'view' || action.kind === 'pay' || !onAction) {
      onPress(order.id);
      return;
    }
    onAction(order, action.kind);
  }, [action.kind, onAction, onPress, order]);

  const [first] = order.items;
  const meta = [
    first?.size ? `Size: ${first.size}` : null,
    first?.color ? `Color: ${first.color}` : null,
  ].filter(Boolean);

  return (
    <Pressable
      onPress={handlePress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.number}, ${orderTitle(order)}, ${
        order.status.replace('_', ' ')
      }`}
    >
      <Card radius="xl" padding="base">
        <VStack gap="md">
          <HStack align="center" justify="between" gap="sm">
            <OrderNumberRow number={order.number} />
            <HStack align="center" gap="xs">
              <OrderStatusPill status={order.status} />
              <Icon as={ChevronRight} size="sm" color="textTertiary" />
            </HStack>
          </HStack>

          <VStack gap="md">
            <AppText variant="miniMicro" color="textTertiary">
              {`${formatDayMonthYear(order.placedAt)}, ${formatClockTime(
                order.placedAt,
              )}`}
            </AppText>

            <HStack align="start" gap="md">
              <View style={styles.art}>
                <AppImage
                  uri={first?.image ?? null}
                  width={ART - 2}
                  height={ART - 2}
                  radius="none"
                  resizeMode="cover"
                  accessibilityLabel={first?.title ?? 'Order'}
                  fallback={
                    <Emoji
                      size={moderateScale(28)}
                      label={first?.title ?? 'Order'}
                    >
                      {first?.emoji ?? '🎁'}
                    </Emoji>
                  }
                />
              </View>

              <VStack flex={1} gap="xxs">
                <AppText variant="bodyStrong" numberOfLines={2}>
                  {orderTitle(order)}
                </AppText>
                {meta.length > 0 ? (
                  <AppText variant="micro" color="textSecondary">
                    {meta.join('  |  ')}
                  </AppText>
                ) : null}
                <AppText variant="micro" color="textSecondary">
                  {`Qty: ${order.items.reduce(
                    (sum, line) => sum + line.quantity,
                    0,
                  )}`}
                </AppText>
                <PayAmount
                  quote={{
                    coinsApplied: order.coinsUsed,
                    payable: order.payable,
                    currency: order.currency,
                  }}
                  size="md"
                />
              </VStack>

              <View style={styles.action}>
                <Button
                  label={action.label}
                  variant="brandOutline"
                  size="sm"
                  fullWidth
                  loading={busy}
                  disabled={busy}
                  onPress={handleAction}
                />
              </View>
            </HStack>
          </VStack>

          {IN_FLIGHT.includes(order.status) ? (
            <VStack gap="md">
              <Divider />
              <OrderTrackerStrip status={order.status} size="sm" />
            </VStack>
          ) : null}
        </VStack>
      </Card>
    </Pressable>
  );
});

OrderCard.displayName = 'OrderCard';
