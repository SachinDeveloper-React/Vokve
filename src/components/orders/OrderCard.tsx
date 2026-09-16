import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { Order } from '../../types/models';
import { formatRelativeDay } from '../../utils/format';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { CoinAmount } from '../wallet/CoinAmount';
import { OrderStatusPill } from './OrderStatusPill';

interface Props {
  order: Order;
  onPress: (id: string) => void;
}

/** What the card calls the order: its one line, or the first with a count. */
export function orderTitle(order: Order): string {
  const [first] = order.items;
  if (!first) return 'Order';
  const more = order.items.length - 1;
  const unit =
    first.quantity > 1 ? `${first.title} × ${first.quantity}` : first.title;
  return more > 0 ? `${unit} + ${more} more` : unit;
}

/**
 * One order in the list: what was bought, when, where it stands, what it cost.
 *
 * The status pill sits on the top line with the date rather than under the
 * title, because "where is it" is the question a user opens this list with,
 * and the eye lands on the first line.
 */
export const OrderCard = memo(({ order, onPress }: Props) => {
  const { colors } = useTheme();
  const handlePress = useCallback(() => onPress(order.id), [onPress, order.id]);
  const [first] = order.items;

  return (
    <Pressable
      onPress={handlePress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={`${orderTitle(order)}, ${order.status}, ${
        order.totalCoins
      } coins`}
    >
      <Card radius="xl" padding="md">
        <HStack align="center" gap="md">
          <Box bg="muted" radius="lg" style={styles.art}>
            <Emoji size={moderateScale(28)} label={first?.title ?? 'Order'}>
              {first?.emoji ?? '🎁'}
            </Emoji>
          </Box>

          <VStack flex={1} gap="xxs">
            <HStack align="center" justify="between" gap="sm">
              <AppText variant="micro" color="textTertiary" numberOfLines={1}>
                {formatRelativeDay(order.placedAt)}
              </AppText>
              <OrderStatusPill status={order.status} />
            </HStack>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {orderTitle(order)}
            </AppText>
            <CoinAmount
              amount={order.totalCoins}
              size="sm"
              tint={colors.textSecondary}
            />
          </VStack>

          <Icon as={ChevronRight} size="sm" color="textTertiary" />
        </HStack>
      </Card>
    </Pressable>
  );
});

OrderCard.displayName = 'OrderCard';

const styles = StyleSheet.create({
  art: {
    width: moderateScale(52),
    height: moderateScale(52),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
