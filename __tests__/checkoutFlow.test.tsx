/**
 * The way through the shop — the item's page, the basket, the till — is
 * where money and coins leave the user, so the checks here are about the
 * seams: a sized item cannot go anywhere without a size, "Buy now" takes
 * exactly this line and leaves the basket alone, the checkout draws the
 * server's quote and moves only the coins within it, a placed order is
 * paid through the gateway and lands on its own page, the step-up parks
 * the attempt and the token that comes back finishes it, and an order the
 * server refuses is worded rather than swallowed.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { CartScreen } from '../src/screens/main/CartScreen';
import { CheckoutScreen } from '../src/screens/main/CheckoutScreen';
import { ProductDetailScreen } from '../src/screens/main/ProductDetailScreen';
import { WishlistScreen } from '../src/screens/main/WishlistScreen';
import { WriteReviewScreen } from '../src/screens/main/WriteReviewScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { ApiError } from '../src/services/api/errors';
import { useAddressesStore } from '../src/stores/addressesStore';
import { useAuthStore } from '../src/stores/authStore';
import { useCartStore } from '../src/stores/cartStore';
import { useCheckoutStore } from '../src/stores/checkoutStore';
import { useCoinsStore } from '../src/stores/coinsStore';
import { useOrdersStore } from '../src/stores/ordersStore';
import { useShopStore } from '../src/stores/shopStore';
import { useWishlistStore } from '../src/stores/wishlistStore';
import { shopItems } from '../src/constants/seedData';
import type {
  Address,
  Cart,
  CheckoutResult,
  Order,
  Quote,
  ShopItem,
} from '../src/types/models';

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: Record<string, unknown> | undefined;

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: mockReplace,
    goBack: mockGoBack,
    canGoBack: () => true,
    addListener: jest.fn(() => jest.fn()),
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../src/services/api/endpoints', () => ({
  shopApi: {
    items: jest.fn(),
    item: jest.fn(),
    categories: jest.fn(),
    config: jest.fn(),
    reviews: jest.fn(),
    writeReview: jest.fn(),
    deleteReview: jest.fn(),
  },
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
  orderApi: {
    list: jest.fn(),
    get: jest.fn(),
    count: jest.fn(),
    cancel: jest.fn(),
  },
  addressApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setDefault: jest.fn(),
    remove: jest.fn(),
  },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
  notificationApi: {
    list: jest.fn(),
    counts: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
  authApi: { stepUp: jest.fn(), signOut: jest.fn() },
}));

const {
  shopApi,
  cartApi,
  wishlistApi,
  checkoutApi,
  authApi,
  walletApi,
  addressApi,
} = jest.requireMock('../src/services/api/endpoints') as {
  shopApi: {
    item: jest.Mock;
    items: jest.Mock;
    categories: jest.Mock;
    config: jest.Mock;
    reviews: jest.Mock;
    writeReview: jest.Mock;
  };
  cartApi: { get: jest.Mock; setLine: jest.Mock; clear: jest.Mock };
  wishlistApi: {
    list: jest.Mock;
    ids: jest.Mock;
    add: jest.Mock;
    remove: jest.Mock;
  };
  checkoutApi: { quote: jest.Mock; place: jest.Mock; pay: jest.Mock };
  authApi: { stepUp: jest.Mock };
  walletApi: { get: jest.Mock; transactions: jest.Mock; earnRules: jest.Mock };
  addressApi: { list: jest.Mock };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const HOME: Address = {
  id: 'adr-home',
  label: 'Home',
  name: 'Asha Verma',
  phone: '+919876543210',
  line1: '12 MG Road',
  line2: '',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560001',
  country: 'IN',
  isDefault: true,
};

const cap = shopItems.find(i => i.id === 'cap')!;
const tee = shopItems.find(i => i.id === 'tee')!;
const hoodie = shopItems.find(i => i.id === 'hoodie')!;

/** The server's quote for one of `item`, at the defaults: 30% coins at ₹0.25, ₹49 to ship under ₹999. */
const quoteFor = (
  item: ShopItem,
  size: string | null = null,
  coins: number | 'max' = 'max',
  balance = 5000,
): Quote => {
  const subtotal = item.price;
  const shipping = subtotal >= 99900 ? 0 : 4900;
  const coinsMax = Math.min(item.coinsMax, balance);
  const coinsApplied = coins === 'max' ? coinsMax : Math.min(coins, coinsMax);
  return {
    currency: 'INR',
    lines: [
      {
        itemId: item.id,
        title: item.title,
        emoji: item.emoji,
        quantity: 1,
        size,
        price: item.price,
        mrp: item.mrp,
        lineTotal: item.price,
        inStock: true,
      },
    ],
    mrpTotal: item.mrp ?? item.price,
    discount: (item.mrp ?? item.price) - item.price,
    subtotal,
    shipping,
    total: subtotal + shipping,
    coinValuePaise: 25,
    coinsMax,
    coinsApplied,
    coinsValue: coinsApplied * 25,
    payable: subtotal + shipping - coinsApplied * 25,
    needsStepUp: coinsApplied >= 1000,
  };
};

const orderFor = (
  q: Quote,
  status: Order['status'] = 'pending_payment',
): Order => ({
  id: 'ord-1',
  status,
  items: q.lines.map(l => ({
    itemId: l.itemId,
    title: l.title,
    emoji: l.emoji,
    quantity: l.quantity,
    size: l.size,
    price: l.price,
    mrp: l.mrp,
  })),
  currency: 'INR',
  subtotal: q.subtotal,
  discount: q.discount,
  shipping: q.shipping,
  total: q.total,
  coinsUsed: q.coinsApplied,
  coinsValue: q.coinsValue,
  payable: q.payable,
  payment: {
    provider: q.payable > 0 ? 'mock' : null,
    status:
      status === 'placed'
        ? q.payable > 0
          ? 'paid'
          : 'not_required'
        : 'pending',
    amount: q.payable,
    currency: 'INR',
    providerOrderId: q.payable > 0 ? 'mockord_ord-1' : null,
    paidAt:
      status === 'placed' && q.payable > 0 ? new Date().toISOString() : null,
    expiresAt:
      status === 'pending_payment'
        ? new Date(Date.now() + 1_800_000).toISOString()
        : null,
  },
  address: {
    label: HOME.label,
    name: HOME.name,
    phone: HOME.phone,
    line1: HOME.line1,
    line2: HOME.line2,
    city: HOME.city,
    state: HOME.state,
    postalCode: HOME.postalCode,
    country: HOME.country,
  },
  placedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  trackingRef: null,
  cancellable: true,
});

const checkoutResult = (q: Quote): CheckoutResult => {
  const order = orderFor(q, q.payable > 0 ? 'pending_payment' : 'placed');
  return {
    order,
    balance: 5000 - q.coinsApplied,
    payment:
      q.payable > 0
        ? {
            provider: 'mock',
            orderId: order.id,
            providerOrderId: 'mockord_ord-1',
            amount: q.payable,
            currency: 'INR',
            keyId: null,
            expiresAt: order.payment.expiresAt!,
          }
        : null,
  };
};

const cartWith = (
  item: ShopItem,
  quantity: number,
  size: string | null = null,
): Cart => {
  const q = quoteFor(item, size);
  return {
    lines: [{ item, quantity, size, addedAt: new Date().toISOString() }],
    count: quantity,
    quote: {
      ...q,
      lines: q.lines.map(l => ({
        ...l,
        quantity,
        lineTotal: l.price * quantity,
      })),
    },
  };
};

const EMPTY_REVIEWS = {
  data: [],
  nextCursor: null,
  summary: { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] },
  mine: null,
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockReplace.mockClear();
  mockGoBack.mockClear();
  mockRouteParams = undefined;
  shopApi.item
    .mockReset()
    .mockImplementation(
      async (id: string) => shopItems.find(i => i.id === id)!,
    );
  shopApi.items
    .mockReset()
    .mockResolvedValue({
      data: shopItems,
      nextCursor: null,
      total: shopItems.length,
    });
  shopApi.categories.mockReset().mockResolvedValue([]);
  shopApi.config.mockReset().mockResolvedValue(useShopStore.getState().config);
  shopApi.reviews.mockReset().mockResolvedValue(EMPTY_REVIEWS);
  shopApi.writeReview.mockReset();
  cartApi.get
    .mockReset()
    .mockResolvedValue({ lines: [], count: 0, quote: quoteFor(cap) });
  cartApi.setLine.mockReset();
  wishlistApi.list.mockReset().mockResolvedValue([]);
  wishlistApi.ids.mockReset().mockResolvedValue([]);
  wishlistApi.add.mockReset().mockResolvedValue({ ok: true });
  wishlistApi.remove.mockReset().mockResolvedValue({ ok: true });
  checkoutApi.quote.mockReset();
  checkoutApi.place.mockReset();
  checkoutApi.pay.mockReset();
  authApi.stepUp.mockReset();
  walletApi.get.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.transactions.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.earnRules.mockReset().mockRejectedValue(new Error('offline'));
  addressApi.list.mockReset().mockResolvedValue([]);
  useShopStore.getState().reset();
  useCartStore.getState().reset();
  useWishlistStore.getState().reset();
  useCheckoutStore.getState().reset();
  useOrdersStore.getState().reset();
  useAddressesStore.getState().reset();
  useCoinsStore.setState({ balance: 5000 });
  useAuthStore.setState({
    status: 'authenticated',
    stepUpToken: null,
    pendingVerification: null,
  });
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

const render = async (screen: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>{screen}</ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
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
    .findAll(
      n => n.props?.label === label && typeof n.props.onPress === 'function',
    )
    .at(-1);
  if (!node) throw new Error(`No button labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
};

const buttonNamed = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) =>
  tree.root
    .findAll(
      n => n.props?.label === label && typeof n.props.onPress === 'function',
    )
    .at(-1);

describe('ProductDetailScreen', () => {
  test('shows the money price against the list price, the coin cap, and the sizes; nothing moves without a size', async () => {
    mockRouteParams = { id: 'tee' };
    const tree = await render(<ProductDetailScreen />);

    const text = allText(tree);
    expect(text).toContain('₹799');
    expect(text).toContain('₹1,199');
    expect(text).toContain('33% off');
    expect(text).toContain('Pay up to');
    expect(text).toContain('958'); // 30% of ₹799 at ₹0.25 a coin
    expect(text).toContain('Free delivery on orders over ₹999');
    expect(shopApi.item).toHaveBeenCalledWith('tee');

    await pressButton(tree, 'Add to cart');
    expect(cartApi.setLine).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('Pick a size first.');

    await pressButton(tree, 'Buy now');
    expect(mockNavigate).not.toHaveBeenCalledWith(
      'Checkout',
      expect.anything(),
    );
  });

  test('with a size and a quantity, "Add to cart" writes the line and "Buy now" takes exactly it to the till', async () => {
    mockRouteParams = { id: 'tee' };
    cartApi.setLine.mockResolvedValue(cartWith(tee, 2, 'L'));
    const tree = await render(<ProductDetailScreen />);

    await press(tree, 'Size L');
    await press(tree, `One more ${tee.title}`);
    await pressButton(tree, 'Add to cart');
    expect(cartApi.setLine).toHaveBeenCalledWith({
      itemId: 'tee',
      quantity: 2,
      size: 'L',
    });
    expect(useCartStore.getState().cart?.count).toBe(2);
    expect(allText(tree)).toContain('Added to cart');

    await pressButton(tree, 'Buy now');
    expect(mockNavigate).toHaveBeenCalledWith('Checkout', {
      lines: [{ itemId: 'tee', quantity: 2, size: 'L' }],
    });
  });

  test('a one-size item needs no size; the heart saves it; the review section leads to the form', async () => {
    mockRouteParams = { id: 'cap' };
    cartApi.setLine.mockResolvedValue(cartWith(cap, 1));
    shopApi.reviews.mockResolvedValue({
      data: [
        {
          id: 'rev-1',
          itemId: 'cap',
          rating: 4,
          title: 'Fits well',
          body: 'Stays on through a run.',
          authorName: 'Ravi',
          verified: true,
          mine: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      nextCursor: null,
      summary: { average: 4, count: 1, histogram: [0, 0, 0, 1, 0] },
      mine: null,
    });
    const tree = await render(<ProductDetailScreen />);

    await pressButton(tree, 'Add to cart');
    expect(cartApi.setLine).toHaveBeenCalledWith({
      itemId: 'cap',
      quantity: 1,
      size: null,
    });

    await press(tree, `Save ${cap.title} to wishlist`);
    expect(wishlistApi.add).toHaveBeenCalledWith('cap');

    const text = allText(tree);
    expect(text).toContain('Fits well');
    expect(text).toContain('Verified buyer');
    expect(text).toContain('4.0');
    await pressButton(tree, 'Write a review');
    expect(mockNavigate).toHaveBeenCalledWith('WriteReview', { itemId: 'cap' });
  });
});

describe('CartScreen', () => {
  test('lists the basket from the server with its estimate, and a stepper change writes through', async () => {
    cartApi.get.mockResolvedValue(cartWith(cap, 1));
    cartApi.setLine.mockResolvedValue(cartWith(cap, 2));
    const tree = await render(<CartScreen />);

    let text = allText(tree);
    expect(text).toContain('VOKVE Cap');
    expect(text).toContain('1 item');
    expect(text).toContain('Checkout · ₹363.50'); // ₹449 + ₹49 − 538 coins × ₹0.25

    await press(tree, `One more ${cap.title}`);
    expect(cartApi.setLine).toHaveBeenCalledWith({
      itemId: 'cap',
      quantity: 2,
      size: null,
    });
    text = allText(tree);
    expect(text).toContain('2 items');

    await pressButton(tree, 'Checkout · ₹363.50');
    expect(mockNavigate).toHaveBeenCalledWith('Checkout', { fromCart: true });
  });

  test('an empty basket says so and leads to the shop', async () => {
    const tree = await render(<CartScreen />);
    expect(allText(tree)).toContain('Your cart is empty');
    await pressButton(tree, 'Browse the shop');
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Shop' });
  });
});

describe('CheckoutScreen (RULES R11–R13, O8)', () => {
  test("draws the server's quote with the coins at their ceiling, places the order, pays it, and lands on it", async () => {
    mockRouteParams = { lines: [{ itemId: 'cap', quantity: 1, size: null }] };
    useAddressesStore.setState({ addresses: [HOME] });
    const q = quoteFor(cap);
    checkoutApi.quote.mockResolvedValue(q);
    const result = checkoutResult(q);
    checkoutApi.place.mockResolvedValue(result);
    checkoutApi.pay.mockResolvedValue({
      order: orderFor(q, 'placed'),
      balance: result.balance,
    });

    const tree = await render(<CheckoutScreen />);

    expect(checkoutApi.quote).toHaveBeenCalledWith(
      q.lines.map(l => ({
        itemId: l.itemId,
        quantity: l.quantity,
        size: l.size,
      })),
      'max',
    );
    let text = allText(tree);
    expect(text).toContain('Asha Verma');
    expect(text).toContain('₹449'); // items
    expect(text).toContain('₹49'); // delivery
    expect(text).toContain('538'); // coins, at the ceiling
    expect(text).toContain('− ₹134.50');
    expect(text).toContain('₹363.50');

    // Fewer coins is the user's choice: the money follows at once.
    const slider = tree.root.findAll(
      n => n.props?.accessibilityLabel === 'Coins to use',
    )[0];
    await ReactTestRenderer.act(async () => {
      slider.props.onValueChange(100);
    });
    text = allText(tree);
    expect(text).toContain('− ₹25');
    expect(text).toContain('Pay ₹473');

    await pressButton(tree, 'Pay ₹473');
    expect(checkoutApi.place).toHaveBeenCalledWith(
      {
        lines: q.lines.map(l => ({
          itemId: l.itemId,
          quantity: l.quantity,
          size: l.size,
        })),
        fromCart: undefined,
        addressId: 'adr-home',
        coins: 100,
        stepUpToken: undefined,
      },
      { idempotencyKey: expect.any(String) },
    );
    // The mock gateway pays at once; the proof goes to the server; the order is placed.
    expect(checkoutApi.pay).toHaveBeenCalledWith(
      'ord-1',
      { providerPaymentId: expect.stringMatching(/^mockpay_/) },
      { idempotencyKey: 'ord-1:pay' },
    );
    expect(useOrdersStore.getState().orders[0]).toMatchObject({
      id: 'ord-1',
      status: 'placed',
    });
    expect(useOrdersStore.getState().count).toBe(1);
    expect(mockReplace).toHaveBeenCalledWith('OrderDetail', { id: 'ord-1' });
  });

  test('coins can be switched off entirely; from the basket the order empties it', async () => {
    mockRouteParams = { fromCart: true };
    useAddressesStore.setState({ addresses: [HOME] });
    useCartStore.setState({ cart: cartWith(cap, 1) });
    const q = quoteFor(cap);
    checkoutApi.quote.mockResolvedValue(q);
    const noCoins = quoteFor(cap, null, 0);
    checkoutApi.place.mockResolvedValue(checkoutResult(noCoins));
    checkoutApi.pay.mockResolvedValue({
      order: orderFor(noCoins, 'placed'),
      balance: 5000,
    });
    cartApi.get.mockResolvedValue({
      lines: [],
      count: 0,
      quote: quoteFor(cap),
    });

    const tree = await render(<CheckoutScreen />);
    const toggle = tree.root.findAll(
      n =>
        n.props?.accessibilityLabel === 'Pay with coins' &&
        typeof n.props.onValueChange === 'function',
    )[0];
    await ReactTestRenderer.act(async () => {
      toggle.props.onValueChange(false);
    });
    expect(allText(tree)).toContain('Pay ₹498');

    await pressButton(tree, 'Pay ₹498');
    expect(checkoutApi.place.mock.calls[0][0]).toMatchObject({
      fromCart: true,
      coins: 0,
    });
    expect(cartApi.get).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('OrderDetail', { id: 'ord-1' });
  });

  test('a thousand coins asks for a code: the attempt parks, and the token that comes back finishes it', async () => {
    mockRouteParams = { lines: [{ itemId: 'hoodie', quantity: 1, size: 'L' }] };
    useAddressesStore.setState({ addresses: [HOME] });
    const q = quoteFor(hoodie, 'L');
    expect(q.coinsApplied).toBeGreaterThanOrEqual(1000);
    checkoutApi.quote.mockResolvedValue(q);
    checkoutApi.place
      .mockRejectedValueOnce(
        new ApiError(
          'forbidden',
          'Confirm it is you.',
          403,
          null,
          'STEP_UP_REQUIRED',
        ),
      )
      .mockResolvedValueOnce(checkoutResult(q));
    checkoutApi.pay.mockResolvedValue({
      order: orderFor(q, 'placed'),
      balance: 5000 - q.coinsApplied,
    });
    authApi.stepUp.mockResolvedValue({
      verificationId: 'vrf-1',
      phone: '',
      channel: 'email',
      target: '',
      codeLength: 6,
      expiresInSeconds: 300,
      resendInSeconds: 30,
      devCode: null,
      purpose: 'step_up',
    });

    const tree = await render(<CheckoutScreen />);
    expect(allText(tree)).toContain("we'll ask for a code first");

    // ₹1,499 (free delivery) less 1,798 coins × ₹0.25.
    expect(q.payable).toBe(104950);
    await pressButton(tree, 'Confirm & pay ₹1,049.50');
    expect(authApi.stepUp).toHaveBeenCalledTimes(1);
    expect(useCheckoutStore.getState().pendingCheckout).toMatchObject({
      addressId: 'adr-home',
      coins: q.coinsApplied,
    });
    expect(useAuthStore.getState().pendingVerification).toMatchObject({
      verificationId: 'vrf-1',
    });
    const firstKey = checkoutApi.place.mock.calls[0][1].idempotencyKey;

    await ReactTestRenderer.act(async () => {
      useAuthStore.setState({
        stepUpToken: 'tok-1',
        pendingVerification: null,
      });
    });
    await settle();

    expect(checkoutApi.place).toHaveBeenCalledTimes(2);
    expect(checkoutApi.place.mock.calls[1][0]).toMatchObject({
      stepUpToken: 'tok-1',
      coins: q.coinsApplied,
    });
    expect(checkoutApi.place.mock.calls[1][1].idempotencyKey).toBe(firstKey);
    expect(useCheckoutStore.getState().pendingCheckout).toBeNull();
    expect(useAuthStore.getState().stepUpToken).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith('OrderDetail', { id: 'ord-1' });
  });

  test('backing out of the code drops the attempt', async () => {
    mockRouteParams = { lines: [{ itemId: 'hoodie', quantity: 1, size: 'L' }] };
    useAddressesStore.setState({ addresses: [HOME] });
    const q = quoteFor(hoodie, 'L');
    checkoutApi.quote.mockResolvedValue(q);
    checkoutApi.place.mockRejectedValue(
      new ApiError(
        'forbidden',
        'Confirm it is you.',
        403,
        null,
        'STEP_UP_REQUIRED',
      ),
    );
    authApi.stepUp.mockResolvedValue({
      verificationId: 'vrf-2',
      phone: '',
      channel: 'email',
      target: '',
      codeLength: 6,
      expiresInSeconds: 300,
      resendInSeconds: 30,
      devCode: null,
      purpose: 'step_up',
    });

    const tree = await render(<CheckoutScreen />);
    const pay = tree.root
      .findAll(
        n =>
          typeof n.props?.label === 'string' &&
          n.props.label.startsWith('Confirm & pay') &&
          typeof n.props.onPress === 'function',
      )
      .at(-1)!;
    await ReactTestRenderer.act(async () => {
      pay.props.onPress();
    });
    await settle();
    expect(useCheckoutStore.getState().pendingCheckout).not.toBeNull();

    await ReactTestRenderer.act(async () => {
      useAuthStore.getState().cancelVerification();
    });
    await settle();
    expect(useCheckoutStore.getState().pendingCheckout).toBeNull();
    expect(checkoutApi.place).toHaveBeenCalledTimes(1);
    expect(allText(tree)).toContain('Checkout cancelled');
  });

  test('with no address the button leads to the form; a refused order is worded and the quote asked again', async () => {
    mockRouteParams = { lines: [{ itemId: 'cap', quantity: 1, size: null }] };
    const q = quoteFor(cap);
    checkoutApi.quote.mockResolvedValue(q);
    let tree = await render(<CheckoutScreen />);
    await pressButton(tree, 'Add a delivery address');
    expect(mockNavigate).toHaveBeenCalledWith('AddressForm');
    expect(checkoutApi.place).not.toHaveBeenCalled();

    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
    mounted = null;
    useAddressesStore.setState({ addresses: [HOME] });
    checkoutApi.place.mockRejectedValue(
      new ApiError(
        'unknown',
        'VOKVE Cap is sold out.',
        409,
        { itemId: 'cap' },
        'OUT_OF_STOCK',
      ),
    );
    tree = await render(<CheckoutScreen />);
    expect(checkoutApi.quote).toHaveBeenCalledTimes(2);
    await pressButton(tree, 'Pay ₹363.50');
    expect(allText(tree)).toContain('Sold out');
    expect(checkoutApi.quote).toHaveBeenCalledTimes(3);
    expect(useOrdersStore.getState().orders).toHaveLength(0);
  });

  test('an order the coins cover has no payment step', async () => {
    mockRouteParams = { lines: [{ itemId: 'cap', quantity: 1, size: null }] };
    useAddressesStore.setState({ addresses: [HOME] });
    const q: Quote = {
      ...quoteFor(cap),
      coinsMax: 1992,
      coinsApplied: 1992,
      coinsValue: 49800,
      payable: 0,
      needsStepUp: true,
    };
    checkoutApi.quote.mockResolvedValue(q);
    checkoutApi.place.mockResolvedValue(checkoutResult(q));

    const tree = await render(<CheckoutScreen />);
    await pressButton(tree, 'Place order · 1,992 coins');
    expect(checkoutApi.place).toHaveBeenCalledTimes(1);
    expect(checkoutApi.pay).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('OrderDetail', { id: 'ord-1' });
  });
});

describe('WishlistScreen and WriteReviewScreen', () => {
  test('the wishlist fetches the saved items in full, and an empty one leads to the shop', async () => {
    wishlistApi.list.mockResolvedValue([cap, tee]);
    let tree = await render(<WishlistScreen />);
    let text = allText(tree);
    expect(text).toContain('2 items saved');
    expect(text).toContain(cap.title);
    expect(text).toContain(tee.title);
    expect(useWishlistStore.getState().ids).toEqual(['cap', 'tee']);

    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
    mounted = null;
    useWishlistStore.getState().reset();
    wishlistApi.list.mockResolvedValue([]);
    tree = await render(<WishlistScreen />);
    text = allText(tree);
    expect(text).toContain('Nothing saved yet');
  });

  test("a review needs stars and ten characters, then is sent as the reader's own", async () => {
    mockRouteParams = { itemId: 'cap' };
    shopApi.writeReview.mockResolvedValue({
      id: 'rev-1',
      itemId: 'cap',
      rating: 5,
      title: null,
      body: 'Stays on through a run, and the peak holds.',
      authorName: 'Asha',
      verified: true,
      mine: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const tree = await render(<WriteReviewScreen />);

    await pressButton(tree, 'Post review');
    expect(shopApi.writeReview).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('Tap a star to rate it.');

    await press(tree, '5 stars');
    const body = tree.root
      .findAll(
        n =>
          n.props?.accessibilityLabel === 'Review text' &&
          typeof n.props.onChangeText === 'function',
      )
      .at(-1)!;
    await ReactTestRenderer.act(async () => {
      body.props.onChangeText('Great');
    });
    await pressButton(tree, 'Post review');
    expect(shopApi.writeReview).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      body.props.onChangeText('Stays on through a run, and the peak holds.');
    });
    await pressButton(tree, 'Post review');
    expect(shopApi.writeReview).toHaveBeenCalledWith('cap', {
      rating: 5,
      title: null,
      body: 'Stays on through a run, and the peak holds.',
    });
    expect(mockGoBack).toHaveBeenCalled();
    expect(buttonNamed(tree, 'Post review')).toBeDefined();
  });
});
