/**
 * The wallet states four numbers the user cannot check any other way — a
 * balance, a lifetime pair, a countdown and a month's summary — so the checks
 * here are about the arithmetic behind them rather than the layout: that spent
 * is really earned minus balance, that the month's figures ignore last month's
 * rows, and that an idle wallet's countdown actually counts down.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { WalletScreen } from '../src/screens/main/WalletScreen';
import { ThemeProvider } from '../src/theme';
import {
  COIN_EXPIRY_WINDOW_DAYS,
  useCoinsStore,
} from '../src/stores/coinsStore';
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

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

const tx = (
  id: string,
  amount: number,
  createdAt: string,
  source: CoinTransaction['source'] = 'steps',
): CoinTransaction => ({ id, title: `Entry ${id}`, source, amount, createdAt });

const seed = (transactions: CoinTransaction[]) => {
  const balance = transactions.reduce((sum, e) => sum + e.amount, 0);
  const lifetimeEarned = transactions.reduce(
    (sum, e) => (e.amount > 0 ? sum + e.amount : sum),
    0,
  );
  useCoinsStore.setState({ balance, lifetimeEarned, transactions });
};

/**
 * Torn down between tests: the screen subscribes to the coin store, so a tree
 * left mounted would still be listening when the next test seeds the ledger
 * and would re-render outside `act`.
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
          <WalletScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

/**
 * The three figures in the summary strip, read off `CoinsSummaryItem`'s props.
 *
 * By props rather than by rendered text: every one of these numbers also
 * appears in the ledger above the strip, so a text search cannot tell the
 * month's total apart from the row it came from. The `tint` is what separates a
 * summary item from the lifetime pair, which carries the same label/amount
 * pairing without one. Memo-wrapped components match the predicate twice —
 * once for the wrapper, once for the inner element — so labels are de-duped.
 */
const summaryFigures = (tree: ReactTestRenderer.ReactTestRenderer) => {
  const seen = new Set<string>();

  return tree.root
    .findAll(
      node =>
        node.props?.tint !== undefined &&
        typeof node.props?.label === 'string' &&
        typeof node.props?.amount === 'number',
    )
    .map(node => [node.props.label as string, node.props.amount as number])
    .filter(([label]) => !seen.has(label as string) && seen.add(label as string));
};

const press = (tree: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');

  if (!node) throw new Error(`No pressable labelled "${label}"`);
  ReactTestRenderer.act(() => node.props.onPress());
};

describe('WalletScreen', () => {
  test('shows the balance and the lifetime pair that explains it', async () => {
    seed([tx('a', 18_350, daysAgo(0)), tx('b', -15_900, daysAgo(1), 'purchase')]);

    const text = allText(await render());

    expect(text).toContain('2,450'); // balance
    expect(text).toContain('18,350'); // lifetime earned
    expect(text).toContain('15,900'); // lifetime spent, derived
  });

  test('counts the expiry window down from the newest credit', async () => {
    seed([tx('a', 500, daysAgo(10))]);

    expect(allText(await render())).toContain(
      String(COIN_EXPIRY_WINDOW_DAYS - 10),
    );
  });

  test('a credit today restores the full window', async () => {
    seed([tx('a', 500, daysAgo(0)), tx('b', 100, daysAgo(40))]);

    expect(allText(await render())).toContain(String(COIN_EXPIRY_WINDOW_DAYS));
  });

  test("the month's summary ignores rows from earlier months", async () => {
    // 70 days back is always in a different calendar month than today, where a
    // rolling 30-day window would still be inside it — the figure on screen is
    // labelled "this month", so the two must not be confused.
    seed([
      tx('earned', 300, daysAgo(0)),
      tx('spent', -100, daysAgo(0), 'purchase'),
      tx('old', 9_000, daysAgo(70)),
    ]);

    const tree = await render();
    const summary = summaryFigures(tree);

    // Spent is carried unsigned: the label says which way it went.
    expect(summary).toEqual([
      ['Earned', 300],
      ['Spent', 100],
      ['Balance', 200],
    ]);
  });

  test('shows only the newest four ledger rows', async () => {
    seed([
      tx('r1', 10, daysAgo(0)),
      tx('r2', 20, daysAgo(1)),
      tx('r3', 30, daysAgo(2)),
      tx('r4', 40, daysAgo(3)),
      tx('r5', 50, daysAgo(4)),
    ]);

    const text = allText(await render());

    expect(text).toContain('Entry r4');
    expect(text).not.toContain('Entry r5');
  });

  test('the shop shortcut routes to the shop tab', async () => {
    seed([tx('a', 100, daysAgo(0))]);

    press(await render(), 'Shop. Spend your coins');

    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Shop' });
  });

  test('an empty ledger says so instead of rendering a bare card', async () => {
    seed([]);

    expect(allText(await render())).toContain('No coins yet');
  });
});
