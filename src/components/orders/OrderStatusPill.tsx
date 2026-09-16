import React, { memo } from 'react';
import { useTheme, type ThemeColors } from '../../theme';
import type { OrderStatus } from '../../types/models';
import { Chip } from '../ui/Chip';

type Tint = Extract<
  keyof ThemeColors,
  | 'primary'
  | 'brandAccent'
  | 'success'
  | 'destructive'
  | 'textSecondary'
  | 'warning'
>;

/**
 * How each state reads and what colour it takes (RULES R5). Exhaustive by
 * type: a new state without an entry is a compile error, not a blank pill.
 */
export const ORDER_STATUS_STYLE: Record<
  OrderStatus,
  { label: string; tint: Tint }
> = {
  placed: { label: 'Placed', tint: 'primary' },
  confirmed: { label: 'Confirmed', tint: 'brandAccent' },
  shipped: { label: 'Shipped', tint: 'warning' },
  delivered: { label: 'Delivered', tint: 'success' },
  cancelled: { label: 'Cancelled', tint: 'textSecondary' },
  refunded: { label: 'Refunded', tint: 'destructive' },
};

interface Props {
  status: OrderStatus;
}

export const OrderStatusPill = memo(({ status }: Props) => {
  const { colors } = useTheme();
  const { label, tint } = ORDER_STATUS_STYLE[status];
  return <Chip label={label} tint={colors[tint]} />;
});

OrderStatusPill.displayName = 'OrderStatusPill';
