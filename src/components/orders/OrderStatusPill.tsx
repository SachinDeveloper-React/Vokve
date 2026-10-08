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
  pending_payment: { label: 'Awaiting payment', tint: 'warning' },
  // "Processing" and "Packed" are both the warehouse working on it, so
  // they share the blue; a member reading the list sees one state until
  // the parcel actually moves.
  placed: { label: 'Processing', tint: 'primary' },
  confirmed: { label: 'Packed', tint: 'primary' },
  shipped: { label: 'Shipped', tint: 'success' },
  delivered: { label: 'Delivered', tint: 'success' },
  cancelled: { label: 'Cancelled', tint: 'destructive' },
  refunded: { label: 'Refunded', tint: 'textSecondary' },
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
