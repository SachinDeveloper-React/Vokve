/**
 * The shop's front is where a user finds things, so the checks here are
 * about what steers them: that the filter row and the category tiles both
 * narrow the shelf, that a card leads to the item's page rather than
 * spending on its own, that "Add" puts a one-size item straight in the
 * basket while a sized one opens the page where the sizes are, and that
 * the heart, the cart badge and the wishlist badge all read from their
 * stores.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { ShopScreen } from '../src/screens/main/ShopScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { useAddressesStore } from '../src/stores/addressesStore';
import { useAuthStore } from '../src/stores/authStore';
import { useCartStore } from '../src/stores/cartStore';
import { useCoinsStore } from '../src/stores/coinsStore';
import { useOrdersStore } from '../src/stores/ordersStore';
import { useShopStore } from '../src/stores/shopStore';
import { SHOP_CONFIG, stockShop } from './helpers/shop';
import { useWishlistStore } from '../src/stores/wishlistStore';
import { shopItems } from '../src/constants/seedData';
import type { Cart, CoinTransaction, ShopItem } from '../src/types/models';

const mockNavigate = jest.fn();
// One object for every render, as the real hook gives: the screen's focus
// effect depends on it, and a fresh one each render would re-run it.
const mockNavigation = {
  navigate: mockNavigate,
  addListener: jest.fn(() => jest.fn()),
};

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

// The basket and the wishlist talk to the server; every endpoint the
// stores reach for is stubbed, and each test says what the server answers.
jest.mock('../src/services/api/endpoints', () => ({
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
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
  authApi: { stepUp: jest.fn(), signOut: jest.fn() },
}));

const { shopApi, cartApi, wishlistApi, walletApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  shopApi: { items: jest.Mock; categories: jest.Mock; config: jest.Mock };
  cartApi: { get: jest.Mock; setLine: jest.Mock };
  wishlistApi: { add: jest.Mock; remove: jest.Mock };
  walletApi: { get: jest.Mock; transactions: jest.Mock; earnRules: jest.Mock };
};

/** The basket the server would answer with, holding `quantity` of `item`. */
const cartWith = (
  item: ShopItem,
  quantity: number,
  size: string | null = null,
): Cart => ({
  lines: [{ item, quantity, size, addedAt: new Date().toISOString() }],
  count: quantity,
  quote: {
    currency: 'INR',
    lines: [
      {
        itemId: item.id,
        title: item.title,
        emoji: item.emoji,
        quantity,
        size,
        price: item.price,
        mrp: item.mrp,
        lineTotal: item.price * quantity,
        inStock: true,
      },
    ],
    mrpTotal: (item.mrp ?? item.price) * quantity,
    discount: ((item.mrp ?? item.price) - item.price) * quantity,
    subtotal: item.price * quantity,
    shipping: 4900,
    total: item.price * quantity + 4900,
    coinValuePaise: 25,
    coinsMax: item.coinsMax * quantity,
    coinsApplied: item.coinsMax * quantity,
    coinsValue: item.coinsMax * quantity * 25,
    payable: item.price * quantity + 4900 - item.coinsMax * quantity * 25,
    needsStepUp: false,
  },
});

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const tx = (
  id: string,
  amount: number,
  source: CoinTransaction['source'] = 'steps',
): CoinTransaction => ({
  id,
  title: `Entry ${id}`,
  source,
  amount,
  createdAt: new Date().toISOString(),
});

/** Seeds a balance the store can account for, plus the given purchases. */
const seed = (balance: number, purchases = 0) => {
  const transactions = [
    tx('credit', balance + purchases * 100),
    ...Array.from({ length: purchases }, (_, i) =>
      tx(`order-${i}`, -100, 'purchase'),
    ),
  ];
  useCoinsStore.setState({
    balance,
    lifetimeEarned: balance + purchases * 100,
    transactions,
  });
};

/**
 * Torn down between tests: the screen subscribes to the coin store, so a tree
 * left mounted would still be listening when the next test seeds a balance and
 * would re-render outside `act`.
 */
let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  shopApi.items
    .mockReset()
    .mockResolvedValue({
      data: shopItems,
      nextCursor: null,
      total: shopItems.length,
    });
  shopApi.categories.mockReset().mockResolvedValue([]);
  shopApi.config.mockReset().mockResolvedValue(SHOP_CONFIG);
  cartApi.get.mockReset().mockRejectedValue(new Error('offline'));
  cartApi.setLine.mockReset();
  wishlistApi.add.mockReset().mockResolvedValue({ ok: true });
  wishlistApi.remove.mockReset().mockResolvedValue({ ok: true });
  walletApi.get.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.transactions.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.earnRules.mockReset().mockRejectedValue(new Error('offline'));
  useShopStore.getState().reset();
  stockShop();
  useOrdersStore.getState().reset();
  useAddressesStore.getState().reset();
  useCartStore.getState().reset();
  useWishlistStore.getState().reset();
  // Signed in: a step-up challenge only counts as pending on a session, and
  // the shop only refreshes its catalogue for one.
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

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>
            <ShopScreen />
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
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
  await ReactTestRenderer.act(() => node.props.onPress());
};

/** Waits for the promises a press set off — a mocked server answering. */
const settle = () =>
  ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

/** Presses the button labelled `label` on the card of `itemId`. */
const pressButton = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
  itemId: string,
) => {
  const card = tree.root.findAll(n => n.props?.item?.id === itemId)[0];
  const button = card
    ?.findAll(
      n => n.props?.label === label && typeof n.props.onPress === 'function',
    )
    .at(-1);
  if (!button) throw new Error(`No "${label}" on ${itemId}`);
  await ReactTestRenderer.act(async () => {
    button.props.onPress();
  });
};

const clothing = shopItems.filter(i => i.category === 'clothing');
const gym = shopItems.filter(i => i.category === 'gym');
const deals = shopItems.filter(i => i.isDeal);
const soldOut = shopItems.find(i => !i.inStock)!;
const tee = shopItems.find(i => i.id === 'tee')!;
const shaker = shopItems.find(i => i.id === 'shaker')!;

describe('ShopScreen', () => {
  test('before the first sync the shelf says it is loading, not that the shop is empty', async () => {
    useShopStore.getState().reset();
    shopApi.items.mockReturnValue(new Promise(() => {}));
    seed(5000);

    const tree = await render();

    expect(
      tree.root.findAll(n => n.props?.accessibilityLabel === 'Loading').length,
    ).toBeGreaterThan(0);
    expect(allText(tree)).not.toContain(tee.title);
  });

  test('a first sync that failed offers to try again, and the retry fills the shelf', async () => {
    useShopStore.getState().reset();
    shopApi.items.mockRejectedValueOnce(new Error('offline'));
    seed(5000);

    const tree = await render();
    await settle();
    expect(allText(tree)).toContain("Couldn't load the shop");

    const retry = tree.root
      .findAll(n => n.props?.label === 'Try again')
      .find(n => typeof n.props.onPress === 'function');
    if (!retry) throw new Error('No retry button');
    await ReactTestRenderer.act(async () => retry.props.onPress());
    await settle();

    expect(allText(tree)).toContain(tee.title);
  });

  test('the shelf opens on the whole catalogue, sold-out items included', async () => {
    seed(5000);
    const text = allText(await render());

    for (const item of shopItems) {
      expect(text).toContain(item.title);
    }
    expect(text).toContain('Sold out');
    // Prices are money with the list price beside them; the coin cap reads "up to".
    expect(text).toContain('₹799');
    expect(text).toContain('₹1,199');
    expect(text).toContain('33% off');
  });

  test('a category chip narrows the shelf to that category', async () => {
    seed(5000);
    const tree = await render();

    await press(tree, 'Clothes');
    const text = allText(tree);

    for (const item of clothing) expect(text).toContain(item.title);
    for (const item of gym) expect(text).not.toContain(item.title);
  });

  test('the deals chip cuts across categories to the flagged items', async () => {
    seed(5000);
    const tree = await render();

    await press(tree, 'Deals');
    const text = allText(tree);

    expect(deals.length).toBeGreaterThan(1);
    for (const item of deals) expect(text).toContain(item.title);
    expect(text).not.toContain(tee.title); // a bestseller, not a deal
  });

  test("a category tile shows the shelf's count and opens its page", async () => {
    seed(5000);
    const tree = await render();

    expect(allText(tree)).toContain(`${gym.length} Rewards`);
    await press(tree, `Gym, ${gym.length} rewards`);
    expect(mockNavigate).toHaveBeenCalledWith('ShopBrowse', {
      category: 'gym',
    });
  });

  test("the server's shelf counts outrank the catalogue on hand", async () => {
    seed(5000);
    const summaries = [
      {
        category: 'clothing' as const,
        count: 40,
        inStock: 38,
        subcategories: [],
      },
      { category: 'gym' as const, count: 12, inStock: 12, subcategories: [] },
      { category: 'sports' as const, count: 9, inStock: 9, subcategories: [] },
      {
        category: 'accessories' as const,
        count: 7,
        inStock: 6,
        subcategories: [],
      },
    ];
    useShopStore.setState({ categories: summaries });
    shopApi.categories.mockResolvedValue(summaries);

    const text = allText(await render());
    expect(text).toContain('40 Rewards');
  });

  test('search, "View All", deals and the coins banner each open the right page', async () => {
    seed(5000);
    const tree = await render();

    await press(tree, 'Search the shop');
    expect(mockNavigate).toHaveBeenCalledWith('ShopSearch');

    await press(tree, 'View all Featured Rewards');
    expect(mockNavigate).toHaveBeenCalledWith('ShopBrowse', {
      title: 'All rewards',
    });

    await press(tree, 'Deals');
    await press(tree, 'View all Featured Rewards');
    expect(mockNavigate).toHaveBeenLastCalledWith('ShopBrowse', {
      deals: true,
    });

    await press(tree, 'Best Rewards. Top quality products, curated for you');
    expect(mockNavigate).toHaveBeenLastCalledWith('ShopBrowse', {
      title: 'All rewards',
    });
  });

  test("a card's body opens the item's page, and nothing is spent or added on the way", async () => {
    seed(5000);
    const tree = await render();

    await press(tree, `${tee.title}, view details`);
    expect(mockNavigate).toHaveBeenCalledWith('ProductDetail', { id: 'tee' });
    expect(cartApi.setLine).not.toHaveBeenCalled();
  });

  test('"Add" puts a one-size item straight in the basket and the badge counts it', async () => {
    seed(5000);
    cartApi.setLine.mockResolvedValue(cartWith(shaker, 1));
    const tree = await render();

    await pressButton(tree, 'Add', shaker.id);
    await settle();

    expect(cartApi.setLine).toHaveBeenCalledWith({
      itemId: 'shaker',
      quantity: 1,
      size: null,
    });
    expect(useCartStore.getState().cart?.count).toBe(1);
    expect(allText(tree)).toContain('Added to cart');
    // The header's badge is the basket's units.
    expect(
      tree.root.findAll(n => n.props?.accessibilityLabel === 'Cart, 1 items')
        .length,
    ).toBeGreaterThan(0);
  });

  test('a sized item cannot be added from a card: "Choose size" opens its page instead', async () => {
    seed(5000);
    const tree = await render();

    await pressButton(tree, 'Choose size', tee.id);
    expect(mockNavigate).toHaveBeenCalledWith('ProductDetail', { id: 'tee' });
    expect(cartApi.setLine).not.toHaveBeenCalled();
  });

  test('the heart saves an item at once, the header shows it, and a refusal puts it back', async () => {
    seed(5000);
    const tree = await render();

    await press(tree, `Save ${shaker.title} to wishlist`);
    expect(useWishlistStore.getState().ids).toEqual(['shaker']);
    expect(wishlistApi.add).toHaveBeenCalledWith('shaker');
    expect(
      tree.root.findAll(
        n => n.props?.accessibilityLabel === 'Wishlist, 1 saved',
      ).length,
    ).toBeGreaterThan(0);

    wishlistApi.remove.mockRejectedValueOnce(new Error('Network Error'));
    await press(tree, `Remove ${shaker.title} from wishlist`);
    await settle();
    expect(useWishlistStore.getState().ids).toEqual(['shaker']);
    expect(allText(tree)).toContain("Couldn't update your wishlist");
  });

  test('the cart and the heart in the header open their screens', async () => {
    seed(5000);
    const tree = await render();

    await press(tree, 'Cart');
    expect(mockNavigate).toHaveBeenCalledWith('Cart');
    await press(tree, 'Wishlist');
    expect(mockNavigate).toHaveBeenCalledWith('Wishlist');
  });

  test('a sold-out item cannot be added', async () => {
    seed(5000);
    const tree = await render();

    const card = tree.root.findAll(n => n.props?.item?.id === soldOut.id)[0];
    const button = card
      .findAll(
        n =>
          n.props?.label === 'Sold out' &&
          typeof n.props.onPress === 'function',
      )
      .at(-1);
    expect(button?.props.disabled).toBe(true);
  });
});
