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
import { useCoinsStore } from '../src/stores/coinsStore';
import { shopItems } from '../src/constants/seedData';
import type { CoinTransaction } from '../src/types/models';

const mockNavigate = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

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

  test('a card opens the sheet; the sheet is what spends the coins', async () => {
    seed(5000);
    const tree = await render();
    const before = useCoinsStore.getState().balance;

    await press(tree, 'View Details');
    expect(useCoinsStore.getState().balance).toBe(before); // nothing spent yet
    expect(allText(tree)).toContain(shopItems[0].description);

    await press(tree, 'Redeem');

    expect(useCoinsStore.getState().balance).toBe(before - shopItems[0].priceCoins);
    expect(allText(tree)).toContain('Redeemed');
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

  test('the bag counts the purchases in the ledger', async () => {
    seed(1000, 2);

    const tree = await render();

    expect(
      tree.root.findAll(
        n => n.props?.accessibilityLabel === 'Orders, 2 on the way',
      ).length,
    ).toBeGreaterThan(0);
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
