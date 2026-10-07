/**
 * The shipping page decides where an order goes and what the courier is
 * told, so the checks are about those two things reaching the till intact:
 * the default is where it starts, another address can be picked for this
 * order alone, a new address comes back chosen, the preferences open as the
 * member left them and are saved on the way on, WhatsApp is offered only
 * where the server can send it, and nothing moves without an address.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { SHOP_CONFIG, stockShop } from './helpers/shop';
import { ShippingAddressScreen } from '../src/screens/main/ShippingAddressScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { useAddressesStore } from '../src/stores/addressesStore';
import { useAuthStore } from '../src/stores/authStore';
import { useCartStore } from '../src/stores/cartStore';
import { useCoinsStore } from '../src/stores/coinsStore';
import { useShopStore } from '../src/stores/shopStore';
import type { Address, Cart, Quote } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: Record<string, unknown> | undefined;

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
  addressApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setDefault: jest.fn(),
    remove: jest.fn(),
    deliveryPreferences: jest.fn(),
    setDeliveryPreferences: jest.fn(),
  },
  checkoutApi: { quote: jest.fn(), place: jest.fn(), pay: jest.fn() },
  shopApi: {
    items: jest.fn(),
    item: jest.fn(),
    categories: jest.fn(),
    config: jest.fn(),
  },
  cartApi: {
    get: jest.fn(),
    setLine: jest.fn(),
    removeLine: jest.fn(),
    applyCoupon: jest.fn(),
    removeCoupon: jest.fn(),
    clear: jest.fn(),
  },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
  authApi: { stepUp: jest.fn(), signOut: jest.fn() },
}));

const { addressApi, checkoutApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  addressApi: {
    list: jest.Mock;
    deliveryPreferences: jest.Mock;
    setDeliveryPreferences: jest.Mock;
  };
  checkoutApi: { quote: jest.Mock };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const address = (
  id: string,
  label: string,
  isDefault: boolean,
  line1 = '12 MG Road',
): Address => ({
  id,
  label,
  name: 'Ranjay Singh',
  phone: '+919876543210',
  line1,
  line2: '',
  city: 'New Delhi',
  state: 'Delhi',
  postalCode: '110044',
  country: 'IN',
  isDefault,
});

/** A ₹449 cap at the defaults: 538 coins, ₹363.50 with ₹49 to ship. */
const QUOTE: Quote = {
  currency: 'INR',
  paymentMode: 'mixed',
  lines: [
    {
      itemId: 'cap',
      title: 'VOKVE Cap',
      emoji: '🧢',
      image: null,
      quantity: 1,
      size: null,
      color: null,
      price: 44900,
      mrp: 59900,
      lineTotal: 44900,
      coinPrice: 1796,
      lineCoins: 1796,
      paymentMode: 'mixed',
      inStock: true,
    },
  ],
  mrpTotal: 59900,
  discount: 15000,
  subtotal: 44900,
  coupon: null,
  shipping: 4900,
  total: 49800,
  coinValuePaise: 25,
  coinsMax: 538,
  coinsMin: 0,
  coinsShort: 0,
  coinsApplied: 538,
  paymentMethods: ['coins_upi', 'upi', 'card', 'netbanking'] as const,
  coinsValue: 13450,
  payable: 36350,
  needsStepUp: false,
  inCoins: null,
};

const NOTHING_ASKED = {
  instructions: '',
  whatsappUpdates: false,
  leaveAtDoor: false,
};

let book: Address[] = [];
let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockRouteParams = { fromCart: true };
  book = [
    address('adr-home', 'Home', true, 'H.No. 1124, Gali No. 5'),
    address('adr-office', 'Office', false, 'Office No. 205, Metro Tower'),
  ];
  addressApi.list.mockReset().mockImplementation(async () => book);
  addressApi.deliveryPreferences.mockReset().mockResolvedValue(NOTHING_ASKED);
  addressApi.setDeliveryPreferences
    .mockReset()
    .mockImplementation(async (patch: object) => ({
      ...NOTHING_ASKED,
      ...patch,
    }));
  checkoutApi.quote.mockReset().mockResolvedValue(QUOTE);
  useAddressesStore.getState().reset();
  useShopStore.getState().reset();
  stockShop();
  useCartStore.setState({
    cart: { lines: [], count: 1, quote: QUOTE } as Cart,
  });
  useCoinsStore.setState({ balance: 2450 });
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
    await Promise.resolve();
  });

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>
            <ShippingAddressScreen />
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  await settle();
  return tree;
};

const flatText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText).replace(/\s+/g, ' ');

/** The first node whose props match, with the handler named. */
const find = (
  tree: ReactTestRenderer.ReactTestRenderer,
  match: (props: Record<string, unknown>) => boolean,
  handler: string,
) => {
  const node = tree.root.findAll(
    n => match(n.props ?? {}) && typeof n.props?.[handler] === 'function',
  )[0];
  if (!node) throw new Error(`Nothing to ${handler}`);
  return node;
};

const option = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  find(
    tree,
    p =>
      p.accessibilityRole === 'radio' &&
      String(p.accessibilityLabel).startsWith(`${label},`),
    'onPress',
  );

const call = async (
  node: ReactTestRenderer.ReactTestInstance,
  handler: string,
  ...args: unknown[]
) => {
  await ReactTestRenderer.act(async () => {
    (node.props[handler] as (...a: unknown[]) => void)(...args);
  });
  await settle();
};

const button = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  find(tree, p => p.label === label, 'onPress');

const byLabel = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
  handler = 'onPress',
) => find(tree, p => p.accessibilityLabel === label, handler);

test('lays out the design, starts on the default, and takes the picked address and preferences on to the till', async () => {
  const tree = await render();

  const text = flatText(tree);
  for (const expected of [
    'Shipping Address',
    'Where should we deliver your order?',
    '2,450',
    'Saved Addresses',
    'Manage',
    'Home',
    'Default',
    'H.No. 1124, Gali No. 5',
    'Office',
    'Add New Address',
    'Delivery Preferences',
    'Delivery Instructions (Optional)',
    '0 / 120',
    'Notify me on WhatsApp',
    'Get delivery updates on WhatsApp',
    'Leave at door',
    'Delivery partners may call you for verification if needed.',
    '100% Secure Delivery',
    'Your order is safe with us',
    'You Pay 538 coins + ₹363.50',
  ]) {
    expect(text).toContain(expected);
  }
  expect(option(tree, 'Home').props.accessibilityState).toEqual({
    selected: true,
  });

  await call(option(tree, 'Office'), 'onPress');
  expect(option(tree, 'Office').props.accessibilityState).toEqual({
    selected: true,
  });
  await call(
    byLabel(tree, 'Delivery instructions', 'onChangeText'),
    'onChangeText',
    '  Ring twice ',
  );
  expect(flatText(tree)).toContain('13 / 120');
  await call(
    byLabel(tree, 'Leave at door', 'onValueChange'),
    'onValueChange',
    true,
  );

  await call(button(tree, 'Continue to Checkout'), 'onPress');
  const delivery = {
    instructions: 'Ring twice',
    whatsappUpdates: false,
    leaveAtDoor: true,
  };
  expect(addressApi.setDeliveryPreferences).toHaveBeenCalledWith(delivery);
  expect(mockNavigate).toHaveBeenCalledWith('Checkout', {
    fromCart: true,
    addressId: 'adr-office',
    delivery,
  });
});

test('opens with the saved preferences, and offers WhatsApp only where the server can send it', async () => {
  addressApi.deliveryPreferences.mockResolvedValue({
    instructions: 'Leave at the gate',
    whatsappUpdates: true,
    leaveAtDoor: false,
  });
  let tree = await render();
  expect(
    byLabel(tree, 'Delivery instructions', 'onChangeText').props.value,
  ).toBe('Leave at the gate');
  expect(
    byLabel(tree, 'Notify me on WhatsApp', 'onValueChange').props.value,
  ).toBe(true);
  expect(flatText(tree)).toContain('17 / 120');

  await ReactTestRenderer.act(() => {
    tree.unmount();
  });
  useShopStore.setState({
    config: { ...SHOP_CONFIG, offersWhatsAppUpdates: false },
  });
  tree = await render();
  expect(flatText(tree)).not.toContain('Notify me on WhatsApp');
  await call(button(tree, 'Continue to Checkout'), 'onPress');
  expect(mockNavigate).toHaveBeenLastCalledWith('Checkout', {
    fromCart: true,
    addressId: 'adr-home',
    delivery: {
      instructions: 'Leave at the gate',
      whatsappUpdates: false,
      leaveAtDoor: false,
    },
  });
});

test('a single line is quoted here; a new address comes back chosen; the pencil and Manage lead to the book', async () => {
  const lines = [{ itemId: 'cap', quantity: 1, size: null, color: null }];
  mockRouteParams = { lines };
  const tree = await render();
  expect(checkoutApi.quote).toHaveBeenCalledWith(lines, 'max');
  expect(flatText(tree)).toContain('You Pay 538 coins + ₹363.50');

  await call(button(tree, 'Add New Address'), 'onPress');
  expect(mockNavigate).toHaveBeenCalledWith('AddressForm');
  // The form saved it and the book was read again on the way back.
  book = [...book, address('adr-new', 'Other', false, 'Plot No. 18')];
  await ReactTestRenderer.act(async () => {
    await useAddressesStore.getState().hydrateFromServer();
  });
  expect(option(tree, 'Other').props.accessibilityState).toEqual({
    selected: true,
  });

  await call(byLabel(tree, 'Edit Office'), 'onPress');
  expect(mockNavigate).toHaveBeenCalledWith('AddressForm', {
    id: 'adr-office',
  });
  await call(byLabel(tree, 'Manage'), 'onPress');
  expect(mockNavigate).toHaveBeenCalledWith('Addresses');

  await call(button(tree, 'Continue to Checkout'), 'onPress');
  expect(mockNavigate).toHaveBeenLastCalledWith('Checkout', {
    lines,
    addressId: 'adr-new',
    delivery: NOTHING_ASKED,
  });
});

test('with no saved address it asks for one, and will not go on', async () => {
  book = [];
  const tree = await render();
  const text = flatText(tree);
  expect(text).toContain(
    'No saved addresses yet. Add where this order should go.',
  );
  expect(text).not.toContain('Manage');
  expect(button(tree, 'Continue to Checkout').props.disabled).toBe(true);
});
