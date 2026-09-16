/**
 * Orders are the one place coins turn into something physical, so the checks
 * here are about trust: that the list shows what the server holds, that a
 * cancel really asks first and really refunds, that an order past cancelling
 * says so rather than pretending, and that the way to the address book is
 * where a user who wants to change their door will look.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { OrdersScreen } from '../src/screens/main/OrdersScreen';
import { OrderDetailScreen } from '../src/screens/main/OrderDetailScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { ApiError } from '../src/services/api/errors';
import { useAuthStore } from '../src/stores/authStore';
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
  },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
  addressApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setDefault: jest.fn(),
    remove: jest.fn(),
  },
  shopApi: { items: jest.fn(), item: jest.fn(), redeem: jest.fn() },
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
  };
  walletApi: { get: jest.Mock; transactions: jest.Mock; earnRules: jest.Mock };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const order = (
  id: string,
  status: Order['status'],
  totalCoins = 650,
): Order => ({
  id,
  status,
  items: [
    {
      itemId: 'cap',
      title: 'VOKVE Cap',
      emoji: '🧢',
      quantity: 1,
      priceCoins: totalCoins,
    },
  ],
  totalCoins,
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
  trackingRef: status === 'shipped' ? 'DL123' : null,
  cancellable: status === 'placed' || status === 'confirmed',
});

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockRouteParams = { id: 'ord-1' };
  orderApi.list.mockReset().mockResolvedValue({ data: [], nextCursor: null });
  orderApi.get.mockReset();
  orderApi.count.mockReset().mockResolvedValue(0);
  orderApi.cancel.mockReset();
  walletApi.get.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.transactions.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.earnRules.mockReset().mockRejectedValue(new Error('offline'));
  useOrdersStore.getState().reset();
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
  test("fetches the server's orders on open and lists them newest first with their status", async () => {
    orderApi.list.mockResolvedValue({
      data: [order('ord-2', 'shipped'), order('ord-1', 'placed')],
      nextCursor: null,
    });
    orderApi.count.mockResolvedValue(2);

    const tree = await render(<OrdersScreen />);

    expect(orderApi.list).toHaveBeenCalled();
    const text = allText(tree);
    expect(text).toContain('Shipped');
    expect(text).toContain('Placed');
    expect(text).toContain('VOKVE Cap');
    expect(useOrdersStore.getState().count).toBe(2);
  });

  test('an empty book says so and leads to the shop', async () => {
    const tree = await render(<OrdersScreen />);

    expect(allText(tree)).toContain('No orders yet');
    await pressButton(tree, 'Browse the shop');
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Shop' });
  });

  test('a row opens its order; the footer opens the address book', async () => {
    orderApi.list.mockResolvedValue({
      data: [order('ord-1', 'placed')],
      nextCursor: null,
    });
    const tree = await render(<OrdersScreen />);

    await press(tree, 'VOKVE Cap, placed, 650 coins');
    expect(mockNavigate).toHaveBeenCalledWith('OrderDetail', { id: 'ord-1' });

    const addresses = tree.root
      .findAll(n => n.props?.title === 'Shipping addresses')
      .find(n => typeof n.props.onPress === 'function');
    if (!addresses) throw new Error('No addresses row');
    await ReactTestRenderer.act(() => addresses.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Addresses');
  });

  test('reaching the end asks for the next page and appends it', async () => {
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

    expect(orderApi.list).toHaveBeenLastCalledWith('ord-3');
    expect(useOrdersStore.getState().orders.map(o => o.id)).toEqual([
      'ord-3',
      'ord-2',
    ]);
    expect(allText(tree)).toContain('Delivered');
  });
});

describe('OrderDetailScreen', () => {
  test('shows the order from the cache with its items, address and journey', async () => {
    useOrdersStore.setState({ orders: [order('ord-1', 'confirmed')] });

    const text = allText(await render(<OrderDetailScreen />));

    expect(orderApi.get).not.toHaveBeenCalled();
    expect(text).toContain('Confirmed and being packed.');
    expect(text).toContain('Asha Verma');
    expect(text).toContain('560001');
    expect(text).toContain('Qty 1');
    expect(text).toContain('Cancel order');
  });

  test('a deep link fetches the order the cache has never seen', async () => {
    mockRouteParams = { id: 'ord-9' };
    orderApi.get.mockResolvedValue(order('ord-9', 'shipped'));

    const text = allText(await render(<OrderDetailScreen />));

    expect(orderApi.get).toHaveBeenCalledWith('ord-9');
    expect(text).toContain('On its way with the courier.');
    expect(text).toContain('Tracking DL123');
    expect(text).not.toContain('Cancel order'); // shipped: past cancelling
  });

  test('cancelling asks first, then refunds, refreshes the wallet and updates the row', async () => {
    useOrdersStore.setState({ orders: [order('ord-1', 'placed')], count: 1 });
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
    expect(useOrdersStore.getState().orders[0].status).toBe('cancelled');
    expect(walletApi.get).toHaveBeenCalled();
    const text = allText(tree);
    expect(text).toContain('Cancelled. The coins are back in your wallet.');
    expect(text).not.toContain('Cancel order');
  });

  test('an order that shipped in between is told so, not silently left unchanged', async () => {
    useOrdersStore.setState({ orders: [order('ord-1', 'placed')] });
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
