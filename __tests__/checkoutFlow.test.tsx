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
import { PaymentScreen } from '../src/screens/main/PaymentScreen';
import { OrderConfirmationScreen } from '../src/screens/main/OrderConfirmationScreen';
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
import { SHOP_CONFIG, stockShop } from './helpers/shop';
import { useWishlistStore } from '../src/stores/wishlistStore';
import { shopItems } from '../src/constants/seedData';
import { formatDayRange } from '../src/utils/format';
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
/** The stack under the screen: the checkout above the shipping page, as the app reaches it. */
let mockNavState = {
  index: 1,
  routes: [{ name: 'ShippingAddress' }, { name: 'Checkout' }],
};

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: mockReplace,
    goBack: mockGoBack,
    canGoBack: () => true,
    getState: () => mockNavState,
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
    applyCoupon: jest.fn(),
    removeCoupon: jest.fn(),
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
  appApi: { about: jest.fn() },
}));

const {
  appApi,
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
  cartApi: {
    get: jest.Mock;
    setLine: jest.Mock;
    applyCoupon: jest.Mock;
    removeCoupon: jest.Mock;
    clear: jest.Mock;
  };
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
  appApi: { about: jest.Mock };
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

/** The ways an order can be paid, worked out as the server works them out. */
const methodsFor = (q: {
  coinsMin: number;
  coinsMax: number;
  total: number;
}): Quote['paymentMethods'] => {
  const leastSpent = Math.max(q.coinsMin, 1);
  return SHOP_CONFIG.paymentMethods.filter(method => {
    if (method === 'coins') return q.coinsMax > 0 && q.total <= q.coinsMax * 25;
    if (method === 'coins_upi') {
      return q.coinsMax >= leastSpent && q.total > leastSpent * 25;
    }
    return q.coinsMin === 0 && q.total > 0;
  });
};

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
        image: item.images[0] ?? null,
        quantity: 1,
        size,
        color: null,
        price: item.price,
        mrp: item.mrp,
        lineTotal: item.price,
        coinPrice: item.coinPrice,
        lineCoins: item.coinPrice,
        paymentMode: item.paymentMode,
        inStock: true,
      },
    ],
    paymentMode: 'mixed',
    coupon: null,
    mrpTotal: item.mrp ?? item.price,
    discount: (item.mrp ?? item.price) - item.price,
    subtotal,
    shipping,
    total: subtotal + shipping,
    coinValuePaise: 25,
    coinsMax,
    coinsMin: 0,
    coinsShort: 0,
    coinsApplied,
    coinsValue: coinsApplied * 25,
    paymentMethods: methodsFor({
      coinsMin: 0,
      coinsMax,
      total: subtotal + shipping,
    }),
    payable: subtotal + shipping - coinsApplied * 25,
    needsStepUp: coinsApplied >= 1000,
    inCoins: null,
  };
};

const orderFor = (
  q: Quote,
  status: Order['status'] = 'pending_payment',
): Order => ({
  id: 'ord-1',
  number: 'VKV2610081234',
  status,
  items: q.lines.map(l => ({
    itemId: l.itemId,
    title: l.title,
    emoji: l.emoji,
    image: l.image,
    coinPrice: l.coinPrice,
    quantity: l.quantity,
    size: l.size,
    color: l.color,
    price: l.price,
    mrp: l.mrp,
  })),
  currency: 'INR',
  subtotal: q.subtotal,
  discount: q.discount,
  shipping: q.shipping,
  coupon: null,
  total: q.total,
  inCoins: q.inCoins,
  coinsUsed: q.coinsApplied,
  coinsValue: q.coinsValue,
  payable: q.payable,
  payment: {
    provider: q.payable > 0 ? 'mock' : null,
    method: q.coinsApplied > 0 ? (q.payable > 0 ? 'coins_upi' : 'coins') : 'upi',
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
  delivery: null,
  estimatedDelivery: {
    from: new Date(Date.now() + 4 * 86_400_000).toISOString(),
    to: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  },
  trackingChannels: ['email'],
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
            method: 'coins_upi',
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
    lines: [
      { item, quantity, size, color: null, addedAt: new Date().toISOString() },
    ],
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

/** The basket as a coins-only shop quotes it: the cap at 1,796 coins, 196 to ship. */
const coinsCart = (balance = 5000): Cart => {
  const base = cartWith(cap, 1);
  const total = 1796 + 196;
  return {
    ...base,
    quote: {
      ...base.quote,
      paymentMode: 'coins',
      lines: base.quote.lines.map(l => ({
        ...l,
        coinPrice: 1796,
        lineCoins: 1796,
        paymentMode: 'coins' as const,
      })),
      coinsMin: total,
      coinsMax: Math.min(total, balance),
      coinsShort: Math.max(0, total - balance),
      coinsApplied: total,
      coinsValue: total * 25,
      paymentMethods: total <= balance ? (['coins'] as const) : [],
      payable: 0,
      needsStepUp: true,
      inCoins: { goods: 1796, discount: 0, shipping: 196, total },
    },
  };
};

const COINS_ONLY = {
  ...SHOP_CONFIG,
  paymentMode: 'coins' as const,
  coinShareMin: 1,
  coinShareMax: 1,
  // The server narrows the menu to the mode: coins, and nothing else.
  paymentMethods: ['coins' as const],
};

/** A ₹20-off coupon on a quote, applying. */
const withCoupon = <
  T extends { coupon: unknown; total: number; payable: number },
>(
  quote: T,
): T => ({
  ...quote,
  coupon: { code: 'CAP20', title: '₹20 off', discount: 2000, problem: null },
  total: quote.total - 2000,
  payable: quote.payable - 2000,
});

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
  shopApi.items.mockReset().mockResolvedValue({
    data: shopItems,
    nextCursor: null,
    total: shopItems.length,
  });
  shopApi.categories.mockReset().mockResolvedValue([]);
  shopApi.config.mockReset().mockResolvedValue(SHOP_CONFIG);
  shopApi.reviews.mockReset().mockResolvedValue(EMPTY_REVIEWS);
  shopApi.writeReview.mockReset();
  cartApi.get
    .mockReset()
    .mockResolvedValue({ lines: [], count: 0, quote: quoteFor(cap) });
  cartApi.setLine.mockReset();
  cartApi.applyCoupon.mockReset();
  cartApi.removeCoupon.mockReset();
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
  appApi.about.mockReset().mockResolvedValue({
    links: {
      privacy: 'https://vokve.app/privacy',
      terms: 'https://vokve.app/terms',
      licenses: 'https://vokve.app/licenses',
      website: 'https://vokve.app',
    },
  });
  useShopStore.getState().reset();
  stockShop();
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
/** The text with runs of spaces closed up — a coin figure's glyph leaves a gap. */
const flatText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  allText(tree).replace(/\s+/g, ' ');

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

/**
 * The checkout settles the order and hands it on; the payment page is what
 * places it. This walks that seam the way the app does: press the till's
 * button, take the arguments it navigated with, and open the payment page
 * on them.
 */
const handOff = async (tree: ReactTestRenderer.ReactTestRenderer) => {
  await pressButton(tree, 'Continue to Payment');
  const call = mockNavigate.mock.calls.filter(c => c[0] === 'Payment').at(-1);
  if (!call) throw new Error('The checkout did not hand off to Payment');
  await ReactTestRenderer.act(() => {
    tree.unmount();
  });
  mounted = null;
  mockRouteParams = call[1] as Record<string, unknown>;
  return render(<PaymentScreen />);
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
  /** The till answers for whatever line the page asks about. */
  const quoteTheLine = () =>
    checkoutApi.quote.mockImplementation(
      async (lines: { itemId: string; size: string | null }[]) =>
        quoteFor(shopItems.find(i => i.id === lines[0].itemId)!, lines[0].size),
    );

  test("lays out the redemption — facts, colours, features, information — with the till's own figure under You Pay", async () => {
    mockRouteParams = { id: 'tee' };
    quoteTheLine();
    const tree = await render(<ProductDetailScreen />);

    const text = allText(tree);
    expect(shopApi.item).toHaveBeenCalledWith('tee');
    expect(text).toContain('Product Details');
    expect(text).toContain('5,000'); // the wallet, in the corner
    expect(text).toContain('Premium Quality');
    expect(text).toContain('Dry Fit Polyester');
    expect(text).toContain('S, M, L, XL, XXL');
    expect(text).toContain('₹799');
    expect(text).toContain('₹1,199');
    expect(text).toContain('958'); // 30% of ₹799 at ₹0.25 a coin
    expect(text).toContain('Select Color');
    expect(text).toContain('Black'); // the first colour is picked to begin with
    expect(text).toContain('Key Features');
    expect(text).toContain('Stretchable');
    expect(text).toContain('Product Information');
    expect(text).toContain('Unisex Activewear');
    expect(text).toContain('2–4 working days');
    expect(text).toContain('Free cancellation until it ships');

    // Quoted at the first size until one is picked: the price is the same in every size.
    expect(checkoutApi.quote).toHaveBeenLastCalledWith(
      [{ itemId: 'tee', quantity: 1, size: 'S', color: 'Black' }],
      'max',
    );
    // ₹799 + ₹49 − 958 coins × ₹0.25.
    expect(text).toContain('+ ₹608.50');
    expect(text).toContain('incl. ₹49 delivery');

    await pressButton(tree, 'Redeem Now');
    expect(allText(tree)).toContain('Pick a size first.');
    expect(mockNavigate).not.toHaveBeenCalledWith(
      'Checkout',
      expect.anything(),
    );
  });

  test('the colour and size picked go to the till as exactly this line', async () => {
    mockRouteParams = { id: 'tee' };
    quoteTheLine();
    const tree = await render(<ProductDetailScreen />);

    await press(tree, 'Navy');
    await press(tree, 'Size L');
    expect(checkoutApi.quote).toHaveBeenLastCalledWith(
      [{ itemId: 'tee', quantity: 1, size: 'L', color: 'Navy' }],
      'max',
    );

    await pressButton(tree, 'Redeem Now');
    expect(mockNavigate).toHaveBeenCalledWith('ShippingAddress', {
      lines: [{ itemId: 'tee', quantity: 1, size: 'L', color: 'Navy' }],
    });
    expect(cartApi.setLine).not.toHaveBeenCalled();
  });

  test('a one-size, one-colour item redeems at once; the heart saves it; the balance opens the wallet', async () => {
    mockRouteParams = { id: 'cap' };
    quoteTheLine();
    const tree = await render(<ProductDetailScreen />);

    const text = allText(tree);
    expect(text).not.toContain('Select Color');
    expect(text).not.toContain('Select Size');
    expect(text).toContain('538'); // the coins the till applies
    expect(text).toContain('+ ₹363.50'); // ₹449 + ₹49 − 538 coins × ₹0.25

    await pressButton(tree, 'Redeem Now');
    expect(mockNavigate).toHaveBeenCalledWith('ShippingAddress', {
      lines: [{ itemId: 'cap', quantity: 1, size: null, color: null }],
    });

    await press(tree, `Save ${cap.title} to wishlist`);
    expect(wishlistApi.add).toHaveBeenCalledWith('cap');

    await press(tree, '5,000 coins, open wallet');
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Wallet' });
  });

  test('a sold-out item cannot be redeemed, and an item with no details shows none of those sections', async () => {
    mockRouteParams = { id: 'gym-towel' };
    quoteTheLine();
    const towel = shopItems.find(i => i.id === 'gym-towel')!;
    shopApi.item.mockResolvedValue({ ...towel, inStock: false });
    const tree = await render(<ProductDetailScreen />);

    const text = allText(tree);
    expect(text).not.toContain('Key Features');
    expect(text).toContain('Product Information'); // delivery and returns still apply
    expect(buttonNamed(tree, 'Sold out')?.props.disabled).toBe(true);
  });
});

describe('CartScreen', () => {
  test('lays the basket out like the design, from the server: the line, the coupon box, the sums, You Pay; the stepper writes through', async () => {
    cartApi.get.mockResolvedValue(cartWith(cap, 1));
    cartApi.setLine.mockResolvedValue(cartWith(cap, 2));
    const tree = await render(<CartScreen />);

    const text = flatText(tree);
    expect(text).toContain('My Cart');
    expect(text).toContain('Review your items before checkout');
    expect(text).toContain('5,000'); // the wallet, in the corner
    expect(text).toContain('100% Secure Redemption');
    expect(text).toContain('VOKVE Cap');
    expect(text).toContain('Price: ₹449');
    expect(text).toContain('Have a coupon?');
    expect(text).toContain('Total Items 1');
    expect(text).toContain('Total Price ₹449');
    expect(text).toContain('Delivery ₹49');
    expect(text).toContain('Coins (538) − ₹134.50');
    expect(text).toContain('538 coins + ₹363.50'); // ₹449 + ₹49 − 538 coins × ₹0.25
    expect(text).toContain('Secure Payment');
    expect(text).toContain('2–4 working days');
    expect(text).toContain('Free cancellation until it ships');

    await press(tree, `One more ${cap.title}`);
    expect(cartApi.setLine).toHaveBeenCalledWith({
      itemId: 'cap',
      quantity: 2,
      size: null,
      color: null,
    });
    expect(flatText(tree)).toContain('Total Items 2');

    await pressButton(tree, 'Proceed to Checkout');
    expect(mockNavigate).toHaveBeenCalledWith('ShippingAddress', {
      fromCart: true,
    });
  });

  test('the bin takes the whole line, and Undo puts it back', async () => {
    cartApi.get.mockResolvedValue(cartWith(cap, 2));
    cartApi.setLine
      .mockResolvedValueOnce({ lines: [], count: 0, quote: quoteFor(cap) })
      .mockResolvedValueOnce(cartWith(cap, 2));
    const tree = await render(<CartScreen />);

    await press(tree, `Remove ${cap.title}`);
    expect(cartApi.setLine).toHaveBeenCalledWith({
      itemId: 'cap',
      quantity: 0,
      size: null,
      color: null,
    });
    expect(flatText(tree)).toContain('Your cart is empty');

    await press(tree, 'Undo');
    expect(cartApi.setLine).toHaveBeenLastCalledWith({
      itemId: 'cap',
      quantity: 2,
      size: null,
      color: null,
    });
  });

  test('a coupon goes on from the sheet — refused with the reason first — and comes off again', async () => {
    const basket = cartWith(cap, 1);
    cartApi.get.mockResolvedValue(basket);
    cartApi.applyCoupon
      .mockRejectedValueOnce(
        new ApiError(
          'validation',
          'Add ₹350 more to use FIT50.',
          422,
          { code: 'FIT50' },
          'COUPON_MIN_ORDER',
        ),
      )
      .mockResolvedValueOnce({ ...basket, quote: withCoupon(basket.quote) });
    cartApi.removeCoupon.mockResolvedValue(basket);
    const tree = await render(<CartScreen />);

    await press(tree, 'Have a coupon? Apply coupon');
    const typeCode = (code: string) =>
      ReactTestRenderer.act(async () => {
        tree.root
          .findAll(
            n =>
              n.props?.accessibilityLabel === 'Coupon code' &&
              typeof n.props.onChangeText === 'function',
          )[0]
          .props.onChangeText(code);
      });

    await typeCode('fit50');
    await pressButton(tree, 'Apply');
    expect(cartApi.applyCoupon).toHaveBeenCalledWith('FIT50');
    expect(flatText(tree)).toContain('Add ₹350 more to use FIT50.');

    await typeCode('cap20');
    await pressButton(tree, 'Apply');
    expect(cartApi.applyCoupon).toHaveBeenLastCalledWith('CAP20');
    const text = flatText(tree);
    expect(text).toContain('Coupon applied');
    expect(text).toContain('CAP20 applied');
    expect(text).toContain('You save ₹20 · ₹20 off');
    expect(text).toContain('Coupon (CAP20) − ₹20');
    expect(text).toContain('538 coins + ₹343.50');

    await press(tree, 'Remove coupon CAP20');
    expect(cartApi.removeCoupon).toHaveBeenCalled();
    expect(flatText(tree)).toContain('Have a coupon?');
  });

  test('a coins-only shop reads every figure in coins, and a wallet short of the order shuts the way on', async () => {
    useShopStore.setState({ config: COINS_ONLY });
    cartApi.get.mockResolvedValue(coinsCart());
    const tree = await render(<CartScreen />);

    let text = flatText(tree);
    expect(text).toContain('Price: 1,796 coins');
    expect(text).toContain('Total Price 1,796 coins');
    expect(text).toContain('Delivery 196 coins');
    expect(text).toContain('You Pay 1,992 coins');
    expect(text).toContain(
      'Coins will be deducted from your balance after you confirm your order.',
    );
    expect(text).toContain('100% safe coins');
    expect(text).not.toContain('₹');
    expect(buttonNamed(tree, 'Proceed to Checkout')?.props.disabled).toBe(
      false,
    );

    cartApi.get.mockResolvedValue(coinsCart(1000));
    await ReactTestRenderer.act(async () => {
      await useCartStore.getState().hydrateFromServer();
    });
    text = flatText(tree);
    expect(text).toContain('You need 992 more coins for this order.');
    expect(buttonNamed(tree, 'Proceed to Checkout')?.props.disabled).toBe(true);
  });

  test('a money-only shop has no coins in its sums', async () => {
    useShopStore.setState({
      config: {
        ...SHOP_CONFIG,
        paymentMode: 'money',
        coinShareMin: 0,
        coinShareMax: 0,
      },
    });
    const base = cartWith(cap, 1);
    cartApi.get.mockResolvedValue({
      ...base,
      quote: {
        ...base.quote,
        paymentMode: 'money',
        coinsMax: 0,
        coinsApplied: 0,
        coinsValue: 0,
        payable: 49800,
      },
    });
    const tree = await render(<CartScreen />);

    const text = flatText(tree);
    expect(text).toContain('100% Secure Checkout');
    expect(text).toContain('You Pay ₹498');
    expect(text).not.toContain('Coins (');
    expect(text).toContain(
      "You'll pay by card or UPI after you confirm your order.",
    );
  });

  test('an empty basket says so and leads to the shop', async () => {
    const tree = await render(<CartScreen />);
    expect(flatText(tree)).toContain('Your cart is empty');
    await pressButton(tree, 'Browse the shop');
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Shop' });
  });
});

describe('CheckoutScreen (RULES R11–R13, O8)', () => {
  test('lays the till out like the design: the secure word, the address, the items with a way back to the basket, the sums and what confirming does', async () => {
    mockRouteParams = { fromCart: true };
    useAddressesStore.setState({ addresses: [HOME] });
    useCartStore.setState({ cart: cartWith(hoodie, 1, 'L') });
    const q = quoteFor(hoodie, 'L');
    checkoutApi.quote.mockResolvedValue(q);

    const tree = await render(<CheckoutScreen />);
    const text = flatText(tree);

    // The masthead: the page's name, what it is for, and the wallet in the corner.
    expect(text).toContain('Checkout');
    expect(text).toContain('Review your order before payment');
    expect(text).toContain('5,000');

    expect(text).toContain('Secure Checkout');
    expect(text).toContain('Your order details are protected and secure');

    expect(text).toContain('Delivery Address');
    expect(text).toContain('Default');
    expect(text).toContain('Asha Verma');
    expect(text).toContain('+919876543210');

    expect(text).toContain('Order Items');
    expect(text).toContain(hoodie.title);
    expect(text).toContain('Size: L');
    expect(text).toContain('Qty: 1');

    expect(text).toContain('Order Summary');
    expect(text).toContain('Total Items');
    expect(text).toContain('Subtotal');
    expect(text).toContain('Delivery');
    expect(text).toContain('Free'); // the hoodie clears the free-shipping bar
    expect(text).toContain('Coupon / Discount —'); // none applied, and the shop offers them
    expect(text).toContain('Total Payable');

    // What confirming does, before the button that does it.
    expect(text).toContain(
      `${q.coinsApplied.toLocaleString('en-IN')} coins will be deducted after you confirm payment.`,
    );

    expect(text).toContain('You Pay');
    expect(text).toContain('100% Secure Checkout');
    expect(buttonNamed(tree, 'Continue to Payment')).toBeDefined();

    // The basket is one tap away for a change of mind.
    await press(tree, 'Edit Cart');
    expect(mockNavigate).toHaveBeenCalledWith('Cart');
  });

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
      null,
    );
    let text = allText(tree);
    expect(text).toContain('Asha Verma');
    expect(text).toContain('₹449'); // items
    expect(text).toContain('₹49'); // delivery
    expect(text).toContain('538'); // coins, at the ceiling
    expect(text).toContain('− ₹134.50');
    expect(text).toContain('₹363.50');
    expect(text).toContain('You Pay');
    expect(text).toContain('100% Secure Checkout');

    // Fewer coins is the user's choice: the money follows at once.
    const slider = tree.root.findAll(
      n => n.props?.accessibilityLabel === 'Coins to use',
    )[0];
    await ReactTestRenderer.act(async () => {
      slider.props.onValueChange(100);
    });
    text = allText(tree);
    expect(text).toContain('− ₹25');
    expect(text).toContain('₹473');

    const payment = await handOff(tree);
    // The coins the slider settled on travel with it, and the page offers
    // the split — 538 coins would not clear ₹498, so "Pay with Coins" is out.
    expect(allText(payment)).toContain('Coins + UPI / Card');
    expect(
      buttonNamed(payment, 'Pay Now')?.props.disabled,
    ).toBe(false);

    await pressButton(payment, 'Pay Now');
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
        couponCode: undefined,
        delivery: undefined,
        paymentMethod: 'coins_upi',
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
    expect(mockReplace).toHaveBeenCalledWith('OrderConfirmation', {
      id: 'ord-1',
    });
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
    expect(allText(tree)).toContain('₹498');

    const payment = await handOff(tree);
    // No coins on the order, so the gateway on its own is what it can take.
    expect(allText(payment)).toContain('Pay with UPI');
    await pressButton(payment, 'Pay Now');
    expect(checkoutApi.place.mock.calls[0][0]).toMatchObject({
      fromCart: true,
      coins: 0,
      paymentMethod: 'upi',
    });
    expect(cartApi.get).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('OrderConfirmation', {
      id: 'ord-1',
    });
  });

  test('a coins-only order has no slider: it takes exactly its coins, and the coupon the basket showed rides along', async () => {
    mockRouteParams = { fromCart: true };
    useAddressesStore.setState({ addresses: [HOME] });
    useShopStore.setState({ config: COINS_ONLY });
    const basket = coinsCart();
    useCartStore.setState({
      cart: { ...basket, quote: withCoupon(basket.quote) },
    });
    const q: Quote = {
      ...withCoupon(basket.quote),
      coinsMin: 1912,
      coinsMax: 1912,
      coinsApplied: 1912,
      coinsValue: 1912 * 25,
      payable: 0,
      inCoins: { goods: 1796, discount: 80, shipping: 196, total: 1912 },
    };
    checkoutApi.quote.mockResolvedValue(q);
    checkoutApi.place.mockResolvedValue(checkoutResult(q));
    cartApi.get.mockResolvedValue({
      lines: [],
      count: 0,
      quote: quoteFor(cap),
    });

    const tree = await render(<CheckoutScreen />);
    expect(checkoutApi.quote).toHaveBeenCalledWith(
      [{ itemId: 'cap', quantity: 1, size: null, color: null }],
      'max',
      'CAP20',
    );
    const text = allText(tree);
    expect(text).toContain('Order Summary');
    expect(text).toContain('Coupon (CAP20) − 80 coins');
    // A coins-only shop has nothing to decide, so the coins panel goes.
    expect(text).not.toContain('Use Your Coins');
    expect(text).toContain('1,912 coins will be deducted');
    expect(
      tree.root.findAll(n => n.props?.accessibilityLabel === 'Coins to use'),
    ).toHaveLength(0);

    const payment = await handOff(tree);
    // One way to pay in a coins-only shop, and it is already picked.
    const text2 = allText(payment);
    expect(text2).toContain('Pay with Coins');
    expect(text2).not.toContain('Pay with UPI');
    expect(text2).toContain('Available: 5,000 coins');

    await pressButton(payment, 'Pay Now');
    expect(checkoutApi.place.mock.calls[0][0]).toMatchObject({
      fromCart: true,
      coins: 1912,
      couponCode: 'CAP20',
      paymentMethod: 'coins',
    });
  });

  test('a coupon that stopped applying is refused, dropped, and the order re-quoted without it', async () => {
    mockRouteParams = { fromCart: true };
    useAddressesStore.setState({ addresses: [HOME] });
    const basket = cartWith(cap, 1);
    useCartStore.setState({
      cart: { ...basket, quote: withCoupon(basket.quote) },
    });
    checkoutApi.quote
      .mockResolvedValueOnce(withCoupon(quoteFor(cap)))
      .mockResolvedValue(quoteFor(cap));
    checkoutApi.place.mockRejectedValueOnce(
      new ApiError(
        'validation',
        'This coupon has just been fully claimed.',
        422,
        { code: 'CAP20' },
        'COUPON_USED_UP',
      ),
    );

    const tree = await render(<CheckoutScreen />);
    // ₹449 − ₹20 + ₹49 − 538 coins × ₹0.25.
    expect(allText(tree)).toContain('₹343.50');

    const payment = await handOff(tree);
    await pressButton(payment, 'Pay Now');
    expect(checkoutApi.place.mock.calls[0][0]).toMatchObject({
      couponCode: 'CAP20',
    });
    expect(allText(payment)).toContain('Coupon no longer applies');
    expect(checkoutApi.quote).toHaveBeenLastCalledWith(
      expect.any(Array),
      'max',
      null,
    );
    expect(allText(payment)).toContain('₹363.50');
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
    // The till warns about the code before it hands on.
    expect(allText(tree)).toContain("we'll ask for a code first");

    // ₹1,499 (free delivery) less 1,798 coins × ₹0.25.
    expect(q.payable).toBe(104950);
    expect(allText(tree)).toContain('₹1,049.50');

    const payment = await handOff(tree);
    await pressButton(payment, 'Pay Now');
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
    expect(mockReplace).toHaveBeenCalledWith('OrderConfirmation', {
      id: 'ord-1',
    });
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

    const payment = await handOff(await render(<CheckoutScreen />));
    await pressButton(payment, 'Pay Now');
    expect(useCheckoutStore.getState().pendingCheckout).not.toBeNull();

    await ReactTestRenderer.act(async () => {
      useAuthStore.getState().cancelVerification();
    });
    await settle();
    expect(useCheckoutStore.getState().pendingCheckout).toBeNull();
    expect(checkoutApi.place).toHaveBeenCalledTimes(1);
    expect(allText(payment)).toContain('Payment cancelled');
  });

  test('places the order to the address and with the preferences the shipping page chose; Change goes back to it', async () => {
    const OFFICE: Address = {
      ...HOME,
      id: 'adr-office',
      label: 'Office',
      line1: 'Office No. 205, Metro Tower',
      isDefault: false,
    };
    useAddressesStore.setState({ addresses: [HOME, OFFICE] });
    const chosen = {
      instructions: 'Ring twice',
      whatsappUpdates: true,
      leaveAtDoor: true,
    };
    mockRouteParams = {
      lines: [{ itemId: 'cap', quantity: 1, size: null }],
      addressId: 'adr-office',
      delivery: chosen,
    };
    const q = quoteFor(cap);
    checkoutApi.quote.mockResolvedValue(q);
    checkoutApi.place.mockResolvedValue(checkoutResult(q));
    checkoutApi.pay.mockResolvedValue({
      order: orderFor(q, 'placed'),
      balance: 5000,
    });

    const tree = await render(<CheckoutScreen />);
    const text = allText(tree);
    expect(text).toContain('Delivery Address');
    expect(text).toContain('Office');
    expect(text).toContain('Office No. 205, Metro Tower');
    expect(text).toContain('Leave at door · WhatsApp updates · “Ring twice”');

    await press(tree, 'Change delivery address');
    expect(mockGoBack).toHaveBeenCalled();

    const payment = await handOff(tree);
    await pressButton(payment, 'Pay Now');
    expect(checkoutApi.place.mock.calls[0][0]).toMatchObject({
      addressId: 'adr-office',
      delivery: chosen,
    });
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
    const payment = await handOff(tree);
    // The payment page asks the till for itself, then again when refused.
    expect(checkoutApi.quote).toHaveBeenCalledTimes(3);
    await pressButton(payment, 'Pay Now');
    expect(allText(payment)).toContain('Sold out');
    expect(checkoutApi.quote).toHaveBeenCalledTimes(4);
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
      // 1,992 coins clear the ₹498 bill, so coins is the one way to pay.
      paymentMethods: ['coins'],
      needsStepUp: true,
    };
    checkoutApi.quote.mockResolvedValue(q);
    checkoutApi.place.mockResolvedValue(checkoutResult(q));

    const payment = await handOff(await render(<CheckoutScreen />));
    // The coins clear the bill, so paying with them is what the page offers.
    expect(allText(payment)).toContain('Pay with Coins');
    await pressButton(payment, 'Pay Now');
    expect(checkoutApi.place.mock.calls[0][0]).toMatchObject({
      coins: 1992,
      paymentMethod: 'coins',
    });
    expect(checkoutApi.place).toHaveBeenCalledTimes(1);
    expect(checkoutApi.pay).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('OrderConfirmation', {
      id: 'ord-1',
    });
  });
});

describe('PaymentScreen (RULES R12)', () => {
  /** The page as the checkout leaves it: this line, this address, these coins. */
  const openPayment = async (params: Record<string, unknown> = {}) => {
    mockRouteParams = {
      lines: [{ itemId: 'cap', quantity: 1, size: null }],
      addressId: 'adr-home',
      coins: 538,
      couponCode: null,
      ...params,
    };
    return render(<PaymentScreen />);
  };

  test('lays the page out like the design: the line, the coins hint, every method the shop takes, the secure word, the sums and Pay Now', async () => {
    useAddressesStore.setState({ addresses: [HOME] });
    checkoutApi.quote.mockResolvedValue(quoteFor(cap));

    const tree = await openPayment();
    const text = flatText(tree);

    expect(text).toContain('Payment');
    expect(text).toContain('Choose your payment method');
    expect(text).toContain('5,000'); // the wallet, in the corner

    expect(text).toContain(cap.title);
    expect(text).toContain('Qty: 1');

    expect(text).toContain('Pay using coins or coins + cash');
    expect(text).toContain(
      'Use your coin balance or combine with other payment methods.',
    );

    // 538 coins is ₹134.50 of a ₹498 bill, so coins alone is not one of
    // the ways this order can be paid, and the page does not offer it.
    expect(text).toContain('Select Payment Method');
    expect(text).not.toContain('Use your VOKVE coins balance');
    expect(text).toContain('Coins + UPI / Card');
    expect(text).toContain('Use coins and pay remaining amount');
    expect(text).toContain('Pay with UPI');
    expect(text).toContain('Google Pay, PhonePe, Paytm etc.');
    expect(text).toContain('Pay with Debit/Credit Card');
    expect(text).toContain('Visa, Mastercard, RuPay etc.');
    expect(text).toContain('Net Banking');
    expect(text).toContain('All major banks supported');

    expect(text).toContain('100% Secure Payment');
    expect(text).toContain('Your payment information is safe with us');
    // The mock gateway secures nothing, so the line names no one.
    expect(text).not.toContain('Secured by');

    expect(text).toContain('Order Summary');
    expect(text).toContain('Total Items 1');
    expect(text).toContain('Total Price ₹498');
    expect(text).toContain('You Pay');

    expect(buttonNamed(tree, 'Pay Now')).toBeDefined();
    expect(text).toContain('By continuing, you agree to our');
    expect(text).toContain('Terms & Conditions');
  });

  test('the page offers only the ways the till says this order can be paid, and picking one decides the coins it takes', async () => {
    useAddressesStore.setState({ addresses: [HOME] });
    checkoutApi.quote.mockResolvedValue(quoteFor(cap));
    checkoutApi.place.mockResolvedValue(checkoutResult(quoteFor(cap, null, 0)));
    checkoutApi.pay.mockResolvedValue({
      order: orderFor(quoteFor(cap, null, 0), 'placed'),
      balance: 5000,
    });

    const tree = await openPayment();
    const rowFor = (label: string) =>
      tree.root
        .findAll(
          n =>
            typeof n.props?.accessibilityLabel === 'string' &&
            n.props.accessibilityLabel.startsWith(label) &&
            typeof n.props.onPress === 'function',
        )
        .at(-1);

    // 538 coins is ₹134.50 of a ₹498 bill, so coins alone is not offered.
    expect(rowFor('Pay with Coins')).toBeUndefined();
    expect(rowFor('Coins + UPI / Card')!.props.accessibilityState).toMatchObject(
      { selected: true },
    );
    expect(flatText(tree)).toContain('Available: 5,000 coins');
    expect(flatText(tree)).toContain('You Pay 538 coins + ₹363.50');

    // A gateway on its own spends none of them, and the whole bill is money.
    await press(tree, 'Pay with UPI. Google Pay, PhonePe, Paytm etc.');
    expect(flatText(tree)).toContain('You Pay ₹498');

    await pressButton(tree, 'Pay Now');
    expect(checkoutApi.place.mock.calls[0][0]).toMatchObject({
      coins: 0,
      paymentMethod: 'upi',
    });
  });

  test('an order of coins-only goods offers one way to pay, already chosen', async () => {
    useAddressesStore.setState({ addresses: [HOME] });
    // The wrist wraps are a coins reward: ₹349 is 1,396 coins, 196 to ship.
    const wraps = shopItems.find(i => i.id === 'wrist-wraps')!;
    expect(wraps.paymentMode).toBe('coins');
    const total = 1396 + 196;
    const q: Quote = {
      ...quoteFor(wraps),
      paymentMode: 'coins',
      lines: [{ ...quoteFor(wraps).lines[0], paymentMode: 'coins' }],
      coinsMin: total,
      coinsMax: total,
      coinsApplied: total,
      coinsValue: total * 25,
      payable: 0,
      paymentMethods: ['coins'],
      inCoins: { goods: 1396, discount: 0, shipping: 196, total },
    };
    checkoutApi.quote.mockResolvedValue(q);
    checkoutApi.place.mockResolvedValue(checkoutResult(q));

    const tree = await openPayment({
      lines: [{ itemId: 'wrist-wraps', quantity: 1, size: null }],
      coins: total,
    });
    const text = flatText(tree);

    // One row, and nothing that would take money.
    expect(text).toContain('Pay with Coins');
    expect(text).toContain('Use your VOKVE coins balance');
    expect(text).not.toContain('Coins + UPI / Card');
    expect(text).not.toContain('Pay with UPI');
    expect(text).not.toContain('Pay with Debit/Credit Card');
    expect(text).not.toContain('Net Banking');
    // Every figure reads in coins, and nothing is left to pay.
    expect(text).toContain('Total Price 1,592 coins');
    expect(text).toContain('You Pay 1,592 coins');
    expect(text).not.toContain('\u20b9');

    await pressButton(tree, 'Pay Now');
    expect(checkoutApi.place.mock.calls[0][0]).toMatchObject({
      coins: total,
      paymentMethod: 'coins',
    });
    expect(checkoutApi.pay).not.toHaveBeenCalled();
  });

  test('a money-only shop offers no way that spends coins', async () => {
    useAddressesStore.setState({ addresses: [HOME] });
    useShopStore.setState({
      config: {
        ...SHOP_CONFIG,
        paymentMode: 'money',
        coinShareMin: 0,
        coinShareMax: 0,
        paymentMethods: ['upi', 'card', 'netbanking'],
      },
    });
    checkoutApi.quote.mockResolvedValue({
      ...quoteFor(cap),
      paymentMode: 'money',
      coinsMax: 0,
      coinsApplied: 0,
      coinsValue: 0,
      payable: 49800,
      paymentMethods: ['upi', 'card', 'netbanking'],
    });

    const tree = await openPayment({ coins: 0 });
    const text = flatText(tree);
    expect(text).not.toContain('Pay with Coins');
    expect(text).not.toContain('Coins + UPI / Card');
    expect(text).not.toContain('Pay using coins or coins + cash');
    expect(text).toContain('Pay with UPI');
    expect(text).toContain('You Pay ₹498');
  });

  test('a method the till refuses is worded, and the page asks the till again', async () => {
    useAddressesStore.setState({ addresses: [HOME] });
    checkoutApi.quote.mockResolvedValue(quoteFor(cap));
    checkoutApi.place.mockRejectedValue(
      new ApiError(
        'validation',
        'Your coins do not cover this order. Pick coins with UPI or a card.',
        422,
        { method: 'coins' },
        'PAYMENT_METHOD_MISMATCH',
      ),
    );

    const tree = await openPayment();
    await pressButton(tree, 'Pay Now');
    expect(allText(tree)).toContain("That way of paying won't work");
    expect(allText(tree)).toContain('Pick coins with UPI or a card.');
    expect(checkoutApi.quote).toHaveBeenCalledTimes(2);
    expect(useOrdersStore.getState().orders).toHaveLength(0);
  });
});

describe('OrderConfirmationScreen (RULES R5, R12)', () => {
  /** The page as the payment lands on it: this order, in the cache. */
  const openConfirmation = async (order: Order) => {
    mockRouteParams = { id: order.id };
    useOrdersStore.setState({ orders: [order], count: 1 });
    return render(<OrderConfirmationScreen />);
  };

  test('lays the confirmation out like the design: the verdict, the reference, where it goes, when it arrives, and the way on', async () => {
    const q = quoteFor(cap);
    const placed = orderFor(q, 'placed');
    const tree = await openConfirmation(placed);
    const text = flatText(tree);

    expect(text).toContain('Order Confirmed!');
    expect(text).toContain('Thank you! Your order has been placed.');
    expect(text).toContain('5,000'); // the wallet, in the corner

    // The reference a member reads out, and when they placed it.
    expect(text).toContain('Order ID');
    expect(text).toContain(`#${placed.number}`);
    expect(text).toContain('Order Date');
    expect(text).toContain(cap.title);
    expect(text).toContain('Qty: 1');

    expect(text).toContain('Delivery Address');
    expect(text).toContain('Asha Verma');
    expect(text).toContain('+919876543210');

    // The window and the channels are the server's, never invented here.
    expect(text).toContain('Estimated Delivery');
    expect(text).toContain(
      formatDayRange(
        placed.estimatedDelivery!.from,
        placed.estimatedDelivery!.to,
      ),
    );
    expect(text).toContain(
      'You will receive tracking details via Email.',
    );

    // The four stops, with the first one reached.
    expect(text).toContain('Order Placed');
    expect(text).toContain('Packed');
    expect(text).toContain('Shipped');
    expect(text).toContain('Delivered');

    expect(text).toContain('Keep walking, keep earning!');
    expect(text).toContain('Use your coins for more exciting rewards.');

    await pressButton(tree, 'Track Your Order');
    expect(mockReplace).toHaveBeenCalledWith('OrderDetail', { id: 'ord-1' });
    await pressButton(tree, 'Continue Shopping');
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Shop' });
  });

  test('an order still owing money says so instead, and collects it from here', async () => {
    const q = quoteFor(cap);
    const pending = orderFor(q, 'pending_payment');
    checkoutApi.pay.mockResolvedValue({
      order: orderFor(q, 'placed'),
      balance: 5000 - q.coinsApplied,
    });

    const tree = await openConfirmation(pending);
    const text = flatText(tree);
    expect(text).toContain('Payment Pending');
    expect(text).toContain('Your order is saved and held.');
    // Nothing is on its way yet, so no delivery promise is made.
    expect(text).not.toContain('Order Confirmed!');
    expect(text).not.toContain('Estimated Delivery');
    expect(buttonNamed(tree, 'Track Your Order')).toBeUndefined();

    await pressButton(tree, 'Pay Now');
    expect(checkoutApi.pay).toHaveBeenCalledWith(
      'ord-1',
      { providerPaymentId: expect.stringMatching(/^mockpay_/) },
      { idempotencyKey: 'ord-1:pay' },
    );
    expect(flatText(tree)).toContain('Order Confirmed!');
  });

  test('a cancelled order is worded as one, with no journey to show', async () => {
    const cancelled = orderFor(quoteFor(cap), 'cancelled');
    const tree = await openConfirmation(cancelled);
    const text = flatText(tree);
    expect(text).toContain('Order Cancelled');
    expect(text).toContain('Your coins are back in your wallet.');
    expect(text).not.toContain('Estimated Delivery');
    expect(text).not.toContain('Order Placed');
  });

  test('a coins order reads its line in coins', async () => {
    const q = quoteFor(cap);
    const order: Order = {
      ...orderFor(q, 'placed'),
      inCoins: { goods: 1796, discount: 0, shipping: 196, total: 1992 },
      coinsUsed: 1992,
      payable: 0,
    };
    const tree = await openConfirmation(order);
    const text = flatText(tree);
    expect(text).toContain('1,796 coins');
    expect(text).not.toContain('\u20b9449');
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
