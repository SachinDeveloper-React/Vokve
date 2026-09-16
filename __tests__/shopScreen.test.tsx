/**
 * The shop is where coins leave the wallet, so the checks here are about the
 * spend and what steers it: that the filter row and the category tiles both
 * narrow the shelf, that a card leads to the sheet rather than spending on
 * its own, that the sheet refuses a spend the balance cannot cover and says
 * by how much, and that a redeem really moves the balance and shows up as an
 * order on the bag.
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
import { useCoinsStore } from '../src/stores/coinsStore';
import { useOrdersStore } from '../src/stores/ordersStore';
import { useShopStore } from '../src/stores/shopStore';
import { ApiError } from '../src/services/api/errors';
import { shopItems } from '../src/constants/seedData';
import type { Address, CoinTransaction, Order } from '../src/types/models';

const mockNavigate = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    addListener: jest.fn(() => jest.fn()),
  }),
}));

// The redeem flow talks to the server; every endpoint the stores reach for
// is stubbed, and each test says what the server answers.
jest.mock('../src/services/api/endpoints', () => ({
  shopApi: { items: jest.fn(), item: jest.fn(), redeem: jest.fn() },
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

const { shopApi, authApi, walletApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  shopApi: { redeem: jest.Mock; items: jest.Mock };
  authApi: { stepUp: jest.Mock };
  walletApi: { get: jest.Mock; transactions: jest.Mock; earnRules: jest.Mock };
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

const placedOrder = (itemId: string, priceCoins: number): Order => ({
  id: `ord-${itemId}`,
  status: 'placed',
  items: [{ itemId, title: itemId, emoji: '🎁', quantity: 1, priceCoins }],
  totalCoins: priceCoins,
  address: {
    ...HOME,
    id: undefined,
    isDefault: undefined,
  } as unknown as Order['address'],
  placedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  trackingRef: null,
  cancellable: true,
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
  shopApi.redeem.mockReset();
  shopApi.items.mockReset().mockResolvedValue(shopItems);
  authApi.stepUp.mockReset();
  walletApi.get.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.transactions.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.earnRules.mockReset().mockRejectedValue(new Error('offline'));
  useShopStore.getState().reset();
  useOrdersStore.getState().reset();
  useAddressesStore.getState().reset();
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

const apparel = shopItems.filter(i => i.category === 'apparel');
const gear = shopItems.filter(i => i.category === 'gear');
const deals = shopItems.filter(i => i.isDeal);
const soldOut = shopItems.find(i => !i.inStock)!;
const tee = shopItems.find(i => i.id === 'tee')!;

describe('ShopScreen', () => {
  test('the shelf opens on the whole catalogue, sold-out items included', async () => {
    seed(5000);
    const text = allText(await render());

    for (const item of shopItems) {
      expect(text).toContain(item.title);
    }
    expect(text).toContain('Sold out');
  });

  test('a category chip narrows the shelf to that category', async () => {
    seed(5000);
    const tree = await render();

    await press(tree, 'Apparel');
    const text = allText(tree);

    for (const item of apparel) expect(text).toContain(item.title);
    for (const item of gear) expect(text).not.toContain(item.title);
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

  test('a category tile is the same filter as its chip, with a live count', async () => {
    seed(5000);
    const tree = await render();

    // Counted from the catalogue, so a seed change cannot leave a stale figure.
    expect(allText(tree)).toContain(`${gear.length} Rewards`);

    await press(tree, `Fitness Gear, ${gear.length} rewards`);
    const text = allText(tree);

    for (const item of gear) expect(text).toContain(item.title);
    expect(text).not.toContain(tee.title);
  });

  test('a card opens the sheet; the sheet leads to the checkout, not straight to a spend', async () => {
    seed(5000);
    const tree = await render();
    const before = useCoinsStore.getState().balance;

    await press(tree, 'View Details');
    expect(useCoinsStore.getState().balance).toBe(before); // nothing spent yet
    expect(allText(tree)).toContain(shopItems[0].description);

    await press(tree, 'Redeem');

    // The checkout: nothing has been spent, and with no address on file the
    // only way forward is to add one.
    expect(useCoinsStore.getState().balance).toBe(before);
    expect(shopApi.redeem).not.toHaveBeenCalled();
    const text = allText(tree);
    expect(text).toContain('Confirm redemption');
    expect(text).toContain('Add an address first');
  });

  test('a reward the balance cannot cover says what is missing', async () => {
    seed(tee.priceCoins - 260);
    const tree = await render();

    await press(tree, 'View Details');

    expect(allText(tree)).toContain('Need 260 more');
    // Sold-out and unaffordable buttons are disabled, so the redeem label is
    // present but not pressable.
    const redeem = tree.root
      .findAll(n => n.props?.accessibilityLabel === 'Need 260 more')
      .find(n => typeof n.props.onPress === 'function');
    expect(redeem?.props.accessibilityState?.disabled).toBe(true);
  });

  test("the bag counts the server's orders, not purchase rows (RULES R7)", async () => {
    // Two purchase rows in the ledger, but the server says three orders —
    // one paid for from another device. The bag believes the server.
    seed(1000, 2);
    useOrdersStore.setState({ count: 3 });

    const tree = await render();

    expect(
      tree.root.findAll(
        n => n.props?.accessibilityLabel === 'Orders, 3 on the way',
      ).length,
    ).toBeGreaterThan(0);
  });

  test('the bag opens the orders screen', async () => {
    seed(1000);
    const tree = await render();

    await press(tree, 'Orders');

    expect(mockNavigate).toHaveBeenCalledWith('Orders');
  });

  test('a sold-out item cannot be opened for redeeming', async () => {
    seed(5000);
    const tree = await render();

    const button = tree.root
      .findAll(n => n.props?.accessibilityLabel === 'Sold out')
      .find(n => typeof n.props.onPress === 'function');

    expect(soldOut).toBeDefined();
    expect(button?.props.accessibilityState?.disabled).toBe(true);
  });
});

/** Lets the store's fire-and-forget follow-ups settle. */
const settle = () =>
  ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

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

describe('ShopScreen › redeeming (RULES R2–R4, O8)', () => {
  const towel = shopItems.find(i => i.id === 'jump-rope')!; // 400, under the threshold and in stock

  /**
   * Opens the sheet for an item, then its checkout. The card is found by the
   * `item` prop it was rendered with, and its "View Details" inside it.
   */
  const openCheckout = async (
    tree: ReactTestRenderer.ReactTestRenderer,
    item: (typeof shopItems)[number],
  ) => {
    const card = tree.root.findAll(n => n.props?.item?.id === item.id)[0];
    const button = card
      ?.findAll(
        n =>
          n.props?.label === 'View Details' &&
          typeof n.props.onPress === 'function',
      )
      .at(-1);
    if (!button) throw new Error(`No card for ${item.title}`);
    await ReactTestRenderer.act(() => button.props.onPress());
    await press(tree, 'Redeem');
  };

  test('with an address and enough coins, confirming places the order and moves the balance', async () => {
    seed(5000);
    useAddressesStore.setState({ addresses: [HOME] });
    shopApi.redeem.mockResolvedValue({
      order: placedOrder('jump-rope', 400),
      balance: 4600,
    });

    const tree = await render();
    await openCheckout(tree, towel);
    expect(allText(tree)).toContain('Deliver to · Home');

    await pressButton(tree, 'Confirm & redeem');

    expect(shopApi.redeem).toHaveBeenCalledWith(
      {
        itemId: 'jump-rope',
        quantity: 1,
        addressId: 'adr-home',
        stepUpToken: undefined,
      },
      { idempotencyKey: expect.any(String) },
    );
    expect(useCoinsStore.getState().balance).toBe(4600);
    expect(useOrdersStore.getState().orders[0]).toMatchObject({
      id: 'ord-jump-rope',
    });
    expect(useOrdersStore.getState().count).toBe(1);
    expect(allText(tree)).toContain('Redeemed');
  });

  test('above the threshold the server asks for a code; the token that comes back finishes the order', async () => {
    seed(5000);
    useAddressesStore.setState({ addresses: [HOME] });
    shopApi.redeem
      .mockRejectedValueOnce(
        new ApiError(
          'forbidden',
          'Confirm it is you.',
          403,
          null,
          'STEP_UP_REQUIRED',
        ),
      )
      .mockResolvedValueOnce({
        order: placedOrder('tee', 1200),
        balance: 3800,
      });
    const challenge = {
      verificationId: 'vrf-1',
      phone: '',
      channel: 'email' as const,
      target: 'a•••@example.com',
      codeLength: 6,
      expiresInSeconds: 300,
      resendInSeconds: 30,
      devCode: null,
      purpose: 'step_up',
    };
    authApi.stepUp.mockResolvedValue(challenge);

    const tree = await render();
    await openCheckout(tree, tee);
    expect(allText(tree)).toContain('need a quick code');

    await pressButton(tree, 'Confirm & get code');

    // The attempt is parked, the OTP challenge is pending, nothing is spent.
    expect(authApi.stepUp).toHaveBeenCalledTimes(1);
    expect(useShopStore.getState().pendingRedeem).toMatchObject({
      itemId: 'tee',
      addressId: 'adr-home',
    });
    expect(useAuthStore.getState().pendingVerification).toMatchObject({
      verificationId: 'vrf-1',
    });
    expect(useCoinsStore.getState().balance).toBe(5000);
    const firstKey = shopApi.redeem.mock.calls[0][1].idempotencyKey;

    // The code passes: the auth store holds a token and the challenge is done.
    await ReactTestRenderer.act(async () => {
      useAuthStore.setState({
        stepUpToken: 'tok-1',
        pendingVerification: null,
      });
    });
    await settle();

    expect(shopApi.redeem).toHaveBeenCalledTimes(2);
    expect(shopApi.redeem.mock.calls[1][0]).toMatchObject({
      itemId: 'tee',
      stepUpToken: 'tok-1',
    });
    // The retry is the same attempt: same key, so the server replays rather than doubles.
    expect(shopApi.redeem.mock.calls[1][1].idempotencyKey).toBe(firstKey);
    expect(useShopStore.getState().pendingRedeem).toBeNull();
    expect(useAuthStore.getState().stepUpToken).toBeNull(); // spent
    expect(useCoinsStore.getState().balance).toBe(3800);
    expect(allText(tree)).toContain('Redeemed');
  });

  test('backing out of the code drops the attempt', async () => {
    seed(5000);
    useAddressesStore.setState({ addresses: [HOME] });
    shopApi.redeem.mockRejectedValue(
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

    const tree = await render();
    await openCheckout(tree, tee);
    await pressButton(tree, 'Confirm & get code');
    expect(useShopStore.getState().pendingRedeem).not.toBeNull();

    // The user taps Cancel on the OTP screen: the challenge goes, no token.
    await ReactTestRenderer.act(async () => {
      useAuthStore.getState().cancelVerification();
    });
    await settle();

    expect(useShopStore.getState().pendingRedeem).toBeNull();
    expect(shopApi.redeem).toHaveBeenCalledTimes(1);
    expect(allText(tree)).toContain('Redemption cancelled');
  });

  test('a wallet the server finds short is told so, and nothing changes', async () => {
    seed(5000);
    useAddressesStore.setState({ addresses: [HOME] });
    shopApi.redeem.mockRejectedValue(
      new ApiError(
        'validation',
        'You need 250 more coins for this.',
        422,
        { required: 400, balance: 150 },
        'INSUFFICIENT_COINS',
      ),
    );

    const tree = await render();
    await openCheckout(tree, towel);
    await pressButton(tree, 'Confirm & redeem');

    expect(allText(tree)).toContain('Not enough coins');
    expect(useOrdersStore.getState().orders).toHaveLength(0);
    expect(useShopStore.getState().pendingRedeem).toBeNull();
  });

  test("the checkout's address row opens the address book to choose, or the form to add", async () => {
    seed(5000);
    useAddressesStore.setState({ addresses: [HOME] });
    let tree = await render();
    await openCheckout(tree, towel);
    await press(tree, 'Deliver to Home. Change address');
    expect(mockNavigate).toHaveBeenCalledWith('Addresses', { select: true });

    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
    mounted = null;
    mockNavigate.mockClear();
    useAddressesStore.setState({ addresses: [] });
    tree = await render();
    await openCheckout(tree, towel);
    await press(tree, 'Add a shipping address');
    expect(mockNavigate).toHaveBeenCalledWith('AddressForm');
  });
});
