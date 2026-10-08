/**
 * The parts of an order the server derives on every read — the stops it has
 * made, the line the page leads with, the courier's link, the returns
 * promise — and the two lines of plumbing a test needs to put orders in the
 * cache now that each tab of the list holds its own page.
 *
 * Fixtures build these through `journeyOf` rather than hand-writing them, so
 * a test order is shaped the way the server actually answers.
 *
 * @format
 */

import { useOrdersStore } from '../../src/stores/ordersStore';
import type { Order, OrderFilter, OrderStatus } from '../../src/types/models';

const JOURNEY: readonly OrderStatus[] = [
  'placed',
  'confirmed',
  'shipped',
  'delivered',
];

const TITLE: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting Payment',
  placed: 'Order Placed',
  confirmed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const HEADLINE: Record<OrderStatus, string> = {
  pending_payment: 'Your order is held, waiting for payment.',
  placed: 'Your order is being prepared.',
  confirmed: 'Your order is packed and ready to ship.',
  shipped: 'Your order is on the way!',
  delivered: 'Your order has been delivered.',
  cancelled: 'Your order was cancelled.',
  refunded: 'Your order was refunded.',
};

type Journey = Pick<
  Order,
  'timeline' | 'headline' | 'trackingUrl' | 'returns' | 'addressChangeable'
>;

/** What the server would hang off an order in this state, at this moment. */
export function journeyOf(
  status: OrderStatus,
  at = new Date().toISOString(),
  trackingRef: string | null = null,
): Journey {
  const reached = JOURNEY.indexOf(status);
  const stops = JOURNEY.map((stop, index) => ({
    status: stop,
    title: TITLE[stop],
    at: index <= reached ? at : null,
    done: index <= reached,
  }));
  const timeline =
    status === 'cancelled' || status === 'refunded'
      ? [
          { status: 'placed' as const, title: TITLE.placed, at, done: true },
          { status, title: TITLE[status], at, done: true },
        ]
      : status === 'pending_payment'
      ? [{ status, title: TITLE[status], at, done: true }, ...stops]
      : stops;
  return {
    timeline,
    headline: HEADLINE[status],
    trackingUrl: trackingRef
      ? `https://track.vokve.app/${encodeURIComponent(trackingRef)}`
      : null,
    returns: {
      eligible: status === 'delivered',
      windowDays: 7,
      until: status === 'delivered' ? at : null,
      note: 'Easy returns within 7 days (as per policy).',
    },
    addressChangeable: status === 'pending_payment' || status === 'placed',
  };
}

/** Puts orders in one tab's cache, synced, the way a fetch would leave it. */
export function cacheOrders(
  orders: Order[],
  filter: OrderFilter = 'all',
  count = orders.length,
): void {
  const { tabs } = useOrdersStore.getState();
  useOrdersStore.setState({
    tabs: {
      ...tabs,
      [filter]: {
        ...tabs[filter],
        orders,
        nextCursor: null,
        syncedAt: new Date().toISOString(),
      },
    },
    count,
  });
}

/** The orders one tab is holding. */
export const cachedOrders = (filter: OrderFilter = 'all'): Order[] =>
  useOrdersStore.getState().tabs[filter].orders;
