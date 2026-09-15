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
  useNavigation: () => ({
    navigate: mockNavigate,
    // The screen refreshes on focus; the subscription must exist to be torn down.
    addListener: jest.fn(() => jest.fn()),
  }),
}));

// The screen syncs with the wallet endpoints when signed in; none of these
// tests are about the network, so a session is never started and the API is
// stubbed to make any stray call visible.
jest.mock('../src/services/api/endpoints', () => ({
  walletApi: {
    get: jest.fn(),
    transactions: jest.fn(),
    earnRules: jest.fn(),
  },
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
  useCoinsStore.setState({
    balance,
    lifetimeEarned,
    transactions,
    pending: 0,
    monthSummary: null,
    expiryDaysLeft: null,
    expiresAt: null,
    expiryWindowDays: null,
    expiryWarnDays: null,
    syncedAt: null,
    syncError: null,
  });
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

  test('the earn action opens Referral & Earn', async () => {
    seed([tx('a', 100, daysAgo(0))]);

    press(await render(), 'Earn Coins. More ways to earn');

    expect(mockNavigate).toHaveBeenCalledWith('Referral');
  });

  test('an empty ledger says so instead of rendering a bare card', async () => {
    seed([]);

    expect(allText(await render())).toContain('No coins yet');
  });

  test('the history tile and the ledger\'s "View All" both open the coin history', async () => {
    seed([tx('a', 100, daysAgo(0))]);
    const tree = await render();

    press(tree, 'Coin History. All transactions');
    expect(mockNavigate).toHaveBeenCalledWith('CoinHistory');

    mockNavigate.mockClear();
    press(tree, 'View all transactions');
    expect(mockNavigate).toHaveBeenCalledWith('CoinHistory');
  });

  test("the server's month summary outranks the one added up on the device", async () => {
    // The device only holds the newest fifty rows; the server's figure is the
    // whole month. Once a sync has landed, that is the one on screen.
    seed([tx('earned', 300, daysAgo(0))]);
    useCoinsStore.setState({
      monthSummary: { earned: 2_500, spent: 700, net: 1_800 },
      syncedAt: new Date().toISOString(),
    });

    expect(summaryFigures(await render())).toEqual([
      ['Earned', 2_500],
      ['Spent', 700],
      ['Balance', 1_800],
    ]);
  });

  test("the server's countdown outranks the one derived from the ledger", async () => {
    seed([tx('a', 500, daysAgo(10))]);
    useCoinsStore.setState({ expiryDaysLeft: 7 });

    const text = allText(await render());
    expect(text).toContain('7');
    expect(text).not.toContain(String(COIN_EXPIRY_WINDOW_DAYS - 10));
  });

  test('coins held for verification are shown next to the balance', async () => {
    seed([tx('a', 100, daysAgo(0))]);
    useCoinsStore.setState({ pending: 23.75 });

    expect(allText(await render())).toContain('+23.75 pending verification');
  });

  test('nothing is said about pending coins when there are none', async () => {
    seed([tx('a', 100, daysAgo(0))]);
    useCoinsStore.setState({ pending: 0 });

    expect(allText(await render())).not.toContain('pending verification');
  });

  test('a failed sync is admitted above the balance, and the figures stay', async () => {
    seed([tx('a', 2_450, daysAgo(0))]);
    useCoinsStore.setState({
      syncError: 'No connection.',
      syncedAt: new Date().toISOString(),
    });

    const text = allText(await render());
    expect(text).toContain("Couldn't refresh");
    expect(text).toContain('2,450');
  });

  test('the notice stays away while syncs are succeeding', async () => {
    seed([tx('a', 100, daysAgo(0))]);
    useCoinsStore.setState({ syncError: null });

    expect(allText(await render())).not.toContain("Couldn't refresh");
  });

  describe('coin expiry', () => {
    test('a comfortable window keeps the calm advice', async () => {
      seed([tx('a', 500, daysAgo(0))]);

      const text = allText(await render());
      expect(text).toContain('Stay active to keep your coins secure.');
    });

    test('inside the outer warn threshold the panel asks for coins soon', async () => {
      // 14 days before, like the server's first reminder (RULES E10).
      seed([tx('a', 500, daysAgo(COIN_EXPIRY_WINDOW_DAYS - 14))]);

      const text = allText(await render());
      expect(text).toContain('Earn coins soon to keep them.');
    });

    test('inside the inner threshold it says today', async () => {
      seed([tx('a', 500, daysAgo(COIN_EXPIRY_WINDOW_DAYS - 3))]);

      expect(allText(await render())).toContain('Earn coins today or they expire.');
    });

    test('an empty wallet has nothing to expire, whatever the ledger says', async () => {
      // Earned long ago, spent it all: no coins, so no urgency.
      seed([
        tx('a', 500, daysAgo(COIN_EXPIRY_WINDOW_DAYS - 2)),
        tx('b', -500, daysAgo(1), 'purchase'),
      ]);

      expect(allText(await render())).toContain('Stay active to keep your coins secure.');
    });

    test("the server's warn thresholds outrank the built-in ones", async () => {
      seed([tx('a', 500, daysAgo(0))]);
      useCoinsStore.setState({
        expiryDaysLeft: 20,
        expiryWarnDays: [30, 7],
        syncedAt: new Date().toISOString(),
      });

      expect(allText(await render())).toContain('Earn coins soon to keep them.');
    });

    test('"About Coin Expiry" opens the explainer with the user\'s own numbers', async () => {
      seed([tx('a', 1_240, daysAgo(10))]);
      const tree = await render();

      expect(allText(tree)).not.toContain('How coin expiry works');
      press(tree, 'About coin expiry');

      const text = allText(tree);
      expect(text).toContain('How coin expiry works');
      expect(text).toContain(`${COIN_EXPIRY_WINDOW_DAYS - 10} days left`);
      expect(text).toContain('Your 1,240 coins are safe until');
      expect(text).toContain(`a fresh ${COIN_EXPIRY_WINDOW_DAYS} days`);
      expect(text).toContain('14 days and 3 days before');
    });

    test('the "?" on the label opens the same explainer', async () => {
      seed([tx('a', 100, daysAgo(0))]);
      const tree = await render();

      press(tree, 'Coins Expiry, what is this?');

      expect(allText(tree)).toContain('How coin expiry works');
    });

    test('the explainer is worded from the server\'s window when one has synced', async () => {
      seed([tx('a', 100, daysAgo(0))]);
      useCoinsStore.setState({
        expiryDaysLeft: 60,
        expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
        expiryWindowDays: 60,
        expiryWarnDays: [7],
        syncedAt: new Date().toISOString(),
      });
      const tree = await render();

      press(tree, 'About coin expiry');

      const text = allText(tree);
      expect(text).toContain('a fresh 60 days');
      expect(text).toContain('7 days before');
      expect(text).not.toContain('90');
    });

    test('an empty wallet is told there is nothing to expire yet', async () => {
      seed([]);
      const tree = await render();

      press(tree, 'About coin expiry');

      expect(allText(tree)).toContain('Nothing to expire yet');
    });

    test('"Earn coins" in the explainer closes it and opens Referral & Earn', async () => {
      seed([tx('a', 100, daysAgo(0))]);
      const tree = await render();
      press(tree, 'About coin expiry');

      const earn = tree.root
        .findAll(n => n.props?.label === 'Earn coins')
        .find(n => typeof n.props.onPress === 'function');
      if (!earn) throw new Error('No "Earn coins" button');
      ReactTestRenderer.act(() => earn.props.onPress());

      expect(mockNavigate).toHaveBeenCalledWith('Referral');
    });
  });
});
