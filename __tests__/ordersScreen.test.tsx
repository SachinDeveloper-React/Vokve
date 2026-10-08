/**
 * Orders are the one place coins turn into something physical, so the checks
 * here are about trust: that the list shows what the server holds, that each
 * tab asks the server for its own page rather than sifting one, that the
 * order page's timeline and promises are the server's own, that a cancel
 * really asks first and really refunds, that an order past cancelling says
 * so rather than pretending, and that every action on a row — tracking,
 * buying again, moving the parcel — goes through the server that can
 * actually do it.
 *
 * @format
 */

import React from 'react';
import { Linking, Text as RNText } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { cacheOrders, cachedOrders, journeyOf } from './helpers/orders';
import { OrdersScreen } from '../src/screens/main/OrdersScreen';
import { OrderDetailScreen } from '../src/screens/main/OrderDetailScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { ApiError } from '../src/services/api/errors';
import { useAuthStore } from '../src/stores/authStore';
import { useCartStore } from '../src/stores/cartStore';
import { useCoinsStore } from '../src/stores/coinsStore';
import { useOrdersStore } from '../src/stores/ordersStore';
import type { Order } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { id: string } = { id: 'ord-1' };

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
    addListener: jest.fn(() => jest.fn()),
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../src/services/api/endpoints', () => ({
  orderApi: {
    list: jest.fn(),
    get: jest.fn(),
    count: jest.fn(),
    cancel: jest.fn(),
    changeAddress: jest.fn(),
    reorder: jest.fn(),
  },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
  addressApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setDefault: jest.fn(),
    remove: jest.fn(),
  },
  shopApi: { items: jest.fn(), item: jest.fn(), config: jest.fn() },
  cartApi: {
    get: jest.fn(),
    setLine: jest.fn(),
    removeLine: jest.fn(),
    clear: jest.fn(),
  },
  wishlistApi: {
    list: jest.fn(),
    ids: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
  },
  checkoutApi: { quote: jest.fn(), place: jest.fn(), pay: jest.fn() },
  notificationApi: {
    list: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
  authApi: { stepUp: jest.fn(), signOut: jest.fn() },
}));

const { orderApi, walletApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  orderApi: {
    list: jest.Mock;
    get: jest.Mock;
    count: jest.Mock;
    cancel: jest.Mock;
    changeAddress: jest.Mock;
    reorder: jest.Mock;
  };
  walletApi: { get: jest.Mock; transactions: jest.Mock; earnRules: jest.Mock };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

/** A cap bought with 300 coins (₹75) and ₹423 in money: ₹449 + ₹49 delivery − ₹75. */
const order = (
  id: string,
  status: Order['status'],
  coinsUsed = 300,
): Order => {
  const trackingRef = status === 'shipped' ? 'DL123' : null;
  return {
    id,
    number: `VOK2610${(id.match(/\d+/)?.[0] ?? '1').padStart(4, '0')}`,
    status,
    items: [
      {
        itemId: 'cap',
        title: 'VOKVE Cap',
        emoji: '🧢',
        image: null,
        coinPrice: 1796,
        quantity: 1,
        size: null,
        color: null,
        price: 44900,
        mrp: 59900,
        coinsUsed,
        coinsValue: coinsUsed * 25,
        moneyPaid: 44900 - coinsUsed * 25,
      },
    ],
    currency: 'INR',
    subtotal: 44900,
    discount: 15000,
    shipping: 4900,
    coupon: null,
    total: 49800,
    inCoins: null,
    delivery: null,
    estimatedDelivery: {
      from: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      to: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    },
    trackingChannels: ['email'],
    coinsUsed,
    coinsValue: coinsUsed * 25,
    payable: 49800 - coinsUsed * 25,
    payment: {
      provider: 'mock',
      method: 'coins_upi' as const,
      status:
        status === 'cancelled'
          ? 'refunded'
          : status === 'pending_payment'
          ? 'pending'
          : 'paid',
      amount: 49800 - coinsUsed * 25,
      currency: 'INR',
      providerOrderId: `mockord_${id}`,
      paidAt: status === 'pending_payment' ? null : new Date().toISOString(),
      expiresAt: null,
    },
    address: {
      label: 'Home',
      name: 'Asha Verma',
      phone: '+919876543210',
      line1: '12 MG Road',
      line2: '',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      country: 'IN',
    },
    placedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trackingRef,
    ...journeyOf(status, new Date().toISOString(), trackingRef),
    cancellable:
      status === 'placed' ||
      status === 'confirmed' ||
      status === 'pending_payment',
  };
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockRouteParams = { id: 'ord-1' };
  orderApi.list.mockReset().mockResolvedValue({ data: [], nextCursor: null });
  orderApi.get.mockReset();
  orderApi.count.mockReset().mockResolvedValue(0);
  orderApi.cancel.mockReset();
  orderApi.changeAddress.mockReset();
  orderApi.reorder.mockReset();
  walletApi.get.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.transactions.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.earnRules.mockReset().mockRejectedValue(new Error('offline'));
  (Linking.openURL as unknown as jest.Mock) = jest
    .fn()
    .mockResolvedValue(true);
  useOrdersStore.getState().reset();
  useCartStore.getState().reset();
  useCoinsStore.setState({ balance: 1_000 });
  useAuthStore.setState({ status: 'authenticated' });
});

afterEach(async () => {
  const tree = mounted;
  mounted = null;
  if (tree) {
    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  }
});

const settle = () =>
  ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const render = async (screen: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>{screen}</ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  await settle();
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
};

const pressButton = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = tree.root
    .findAll(n => n.props?.label === label)
    .find(n => typeof n.props.onPress === 'function');
  if (!node) throw new Error(`No button labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
};

describe('OrdersScreen', () => {
  test("fetches the server's orders on open and lists them newest first, by reference, with their status", async () => {
    orderApi.list.mockResolvedValue({
      data: [order('ord-2', 'shipped'), order('ord-1', 'placed')],
      nextCursor: null,
    });
    orderApi.count.mockResolvedValue(2);

    const tree = await render(<OrdersScreen />);

    expect(orderApi.list).toHaveBeenCalledWith(undefined, 'all');
    const text = allText(tree);
    expect(text).toContain('VOK26100002');
    expect(text).toContain('Shipped');
    expect(text).toContain('Processing');
    expect(text).toContain('VOKVE Cap');
    expect(useOrdersStore.getState().count).toBe(2);
  });

  test('an empty book says so and leads to the shop; a tab that found nothing says that instead', async () => {
    const tree = await render(<OrdersScreen />);

    expect(allText(tree)).toContain('No orders yet');
    await pressButton(tree, 'Browse the shop');
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Shop' });

    await press(tree, 'Cancelled');
    expect(allText(tree)).toContain('Nothing cancelled');
  });

  test('each tab asks the server for its own page rather than sifting the one in hand', async () => {
    orderApi.list
      .mockResolvedValueOnce({
        data: [order('ord-2', 'delivered'), order('ord-1', 'cancelled')],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        data: [order('ord-1', 'cancelled')],
        nextCursor: null,
      });
    const tree = await render(<OrdersScreen />);

    await press(tree, 'Cancelled');

    expect(orderApi.list).toHaveBeenLastCalledWith(undefined, 'cancelled');
    expect(cachedOrders('cancelled').map(o => o.id)).toEqual(['ord-1']);
    // The tab it came from keeps its own page, untouched.
    expect(cachedOrders('all').map(o => o.id)).toEqual(['ord-2', 'ord-1']);
  });

  test('a row opens its order, its reference copies, and the footer rows lead on', async () => {
    orderApi.list.mockResolvedValue({
      data: [order('ord-1', 'placed')],
      nextCursor: null,
    });
    const tree = await render(<OrdersScreen />);

    await press(tree, 'Order ID VOK26100001, copy');
    expect(Clipboard.setString).toHaveBeenCalledWith('VOK26100001');
    expect(allText(tree)).toContain('Order ID copied');

    await press(tree, 'Order VOK26100001, VOKVE Cap, placed');
    expect(mockNavigate).toHaveBeenCalledWith('OrderDetail', { id: 'ord-1' });

    const row = (title: string) =>
      tree.root
        .findAll(n => n.props?.title === title)
        .find(n => typeof n.props.onPress === 'function');
    const shopMore = row('Shop More. Earn More.');
    if (!shopMore) throw new Error('No "shop more" row');
    await ReactTestRenderer.act(() => shopMore.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Shop' });

    const addresses = row('Shipping addresses');
    if (!addresses) throw new Error('No addresses row');
    await ReactTestRenderer.act(() => addresses.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Addresses');
  });

  test('reaching the end asks for the next page of the same tab and appends it', async () => {
    orderApi.list
      .mockResolvedValueOnce({
        data: [order('ord-3', 'placed')],
        nextCursor: 'ord-3',
      })
      .mockResolvedValueOnce({
        data: [order('ord-2', 'delivered')],
        nextCursor: null,
      });
    const tree = await render(<OrdersScreen />);

    const list = tree.root.findAll(
      n => typeof n.props?.onEndReached === 'function',
    )[0];
    await ReactTestRenderer.act(async () => {
      list.props.onEndReached();
    });
    await settle();

    expect(orderApi.list).toHaveBeenLastCalledWith('ord-3', 'all');
    expect(cachedOrders().map(o => o.id)).toEqual(['ord-3', 'ord-2']);
    expect(allText(tree)).toContain('Delivered');
  });

  test('a shipped row tracks with the courier; a delivered one buys the order again', async () => {
    orderApi.list.mockResolvedValue({
      data: [order('ord-2', 'shipped'), order('ord-1', 'delivered')],
      nextCursor: null,
    });
    orderApi.reorder.mockResolvedValue({
      cart: { lines: [], count: 1, quote: null },
      added: 1,
      skipped: [],
    });
    const tree = await render(<OrdersScreen />);

    await pressButton(tree, 'Track Order');
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://track.vokve.app/DL123',
    );

    await pressButton(tree, 'Buy Again');
    expect(orderApi.reorder).toHaveBeenCalledWith('ord-1', {
      idempotencyKey: expect.any(String),
    });
    expect(allText(tree)).toContain('Back in your cart');
  });

  test('buying again says which line the catalogue has let go rather than pretending', async () => {
    orderApi.list.mockResolvedValue({
      data: [order('ord-1', 'delivered')],
      nextCursor: null,
    });
    orderApi.reorder.mockResolvedValue({
      cart: { lines: [], count: 0, quote: null },
      added: 0,
      skipped: [
        { title: 'VOKVE Cap', reason: 'One of the items is no longer available.' },
      ],
    });
    const tree = await render(<OrdersScreen />);

    await pressButton(tree, 'Buy Again');
    const text = allText(tree);
    expect(text).toContain("Couldn't buy that again");
    expect(text).toContain('One of the items is no longer available.');
  });
});

describe('OrderDetailScreen', () => {
  test('lays the order out as the design has it: reference, where it stands, what is in it, where it goes, and everything that has happened', async () => {
    cacheOrders([order('ord-1', 'confirmed')]);

    const tree = await render(<OrderDetailScreen />);
    const text = allText(tree);

    expect(orderApi.get).not.toHaveBeenCalled();
    expect(text).toContain('VOK26100001');
    expect(text).toContain('Packed');
    // The line at the head of the tracker is the server's, not ours.
    expect(text).toContain('Your order is packed and ready to ship.');
    expect(text).toContain('Expected by');
    // The timeline carries both what has happened and what has not.
    expect(text).toContain('Order Placed');
    expect(text).toContain('Done');
    expect(text).toContain('Pending');
    expect(text).toContain('Asha Verma');
    expect(text).toContain('560001');
    expect(text).toContain('Easy returns within 7 days (as per policy).');
    expect(text).toContain('Cancel order');
  });

  test('the address can be moved until it is packed, through the server that owns the order', async () => {
    cacheOrders([order('ord-1', 'placed')]);
    const tree = await render(<OrderDetailScreen />);

    await press(tree, 'Change the delivery address');
    expect(mockNavigate).toHaveBeenCalledWith('Addresses', {
      select: true,
      orderId: 'ord-1',
    });
  });

  test('a deep link fetches the order the cache has never seen, and tracks it live', async () => {
    mockRouteParams = { id: 'ord-9' };
    orderApi.get.mockResolvedValue(order('ord-9', 'shipped'));

    const tree = await render(<OrderDetailScreen />);
    const text = allText(tree);

    expect(orderApi.get).toHaveBeenCalledWith('ord-9');
    expect(text).toContain('Your order is on the way!');
    expect(text).toContain('Tracking DL123');
    expect(text).not.toContain('Cancel order'); // shipped: past cancelling
    expect(text).not.toContain('Change'); // and past moving

    await pressButton(tree, 'Track Live');
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://track.vokve.app/DL123',
    );
  });

  test('cancelling asks first, then refunds, refreshes the wallet and updates the row', async () => {
    cacheOrders([order('ord-1', 'placed')], 'all', 1);
    orderApi.cancel.mockResolvedValue({
      order: order('ord-1', 'cancelled'),
      balance: 1_650,
    });
    walletApi.get.mockResolvedValue({
      balance: 1_650,
      pending: 0,
      lifetimeEarned: 5_000,
      expiresAt: null,
      expiryDaysLeft: 90,
      expiryWindowDays: 90,
      expiryWarnDays: [14, 3],
      monthSummary: { earned: 0, spent: 0, net: 0 },
      dailyCap: 300,
      earnedToday: 0,
      remainingToday: 300,
      stepUpThreshold: 1000,
    });
    walletApi.transactions.mockResolvedValue({ data: [], nextCursor: null });
    walletApi.earnRules.mockResolvedValue([]);
    const tree = await render(<OrderDetailScreen />);

    await pressButton(tree, 'Cancel order');
    // Nothing yet: the sheet is asking.
    expect(orderApi.cancel).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('This cannot be undone.');

    await press(tree, 'Cancel this order');

    expect(orderApi.cancel).toHaveBeenCalledWith('ord-1', {
      idempotencyKey: expect.any(String),
    });
    expect(cachedOrders()[0].status).toBe('cancelled');
    expect(walletApi.get).toHaveBeenCalled();
    const text = allText(tree);
    expect(text).toContain('Your order was cancelled.');
    expect(text).not.toContain('Cancel order');
  });

  test('an order that shipped in between is told so, not silently left unchanged', async () => {
    cacheOrders([order('ord-1', 'placed')]);
    orderApi.cancel.mockRejectedValue(
      new ApiError(
        'unknown',
        'An order that is shipped can no longer be cancelled.',
        409,
        { status: 'shipped' },
        'ORDER_NOT_CANCELLABLE',
      ),
    );
    const tree = await render(<OrderDetailScreen />);

    await pressButton(tree, 'Cancel order');
    await press(tree, 'Cancel this order');

    expect(allText(tree)).toContain('Too late to cancel');
  });
});
