/**
 * The wallet states four numbers the user cannot check any other way — a
 * balance, a lifetime pair, a countdown and a month's summary. Every one of
 * them is the server's: the checks here are that the screen shows what the
 * last sync said, that it says it is loading rather than inventing figures
 * before the first one, and that the warnings follow the server's thresholds.
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
import { useCoinsStore } from '../src/stores/coinsStore';
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
// tests start a session, so the API is stubbed to make any stray call visible.
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

const DAY_MS = 86_400_000;

const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();

const tx = (
  id: string,
  amount: number,
  createdAt: string,
  source: CoinTransaction['source'] = 'steps',
): CoinTransaction => ({ id, title: `Entry ${id}`, source, amount, createdAt });

/** A wallet as the last sync left it. */
const synced = (
  figures: Partial<ReturnType<typeof useCoinsStore.getState>> = {},
) => {
  const balance = figures.balance ?? 500;
  useCoinsStore.setState({
    balance,
    lifetimeEarned: balance,
    transactions: [tx('a', balance, daysAgo(0))],
    pending: 0,
    monthSummary: { earned: balance, spent: 0, net: balance },
    expiryDaysLeft: 90,
    expiresAt: new Date(Date.now() + 90 * DAY_MS).toISOString(),
    expiryWindowDays: 90,
    expiryWarnDays: [14, 3],
    earnRules: null,
    dailyCap: 300,
    earnedToday: 0,
    remainingToday: 300,
    syncedAt: new Date().toISOString(),
    isSyncing: false,
    syncError: null,
    ...figures,
  });
};

/**
 * Torn down between tests: the screen subscribes to the coin store, so a tree
 * left mounted would still be listening when the next test sets the wallet
 * and would re-render outside `act`.
 */
let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

const realHydrate = useCoinsStore.getState().hydrateFromServer;

beforeEach(() => {
  mockNavigate.mockClear();
  useCoinsStore.getState().reset();
  useCoinsStore.setState({ hydrateFromServer: realHydrate });
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
 * By props rather than by rendered text: the same numbers can appear in the
 * ledger above the strip. The `tint` is what separates a summary item from
 * the lifetime pair, which carries the same label/amount pairing without
 * one. Memo-wrapped components match twice, so labels are de-duped.
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
    .filter(
      ([label]) => !seen.has(label as string) && seen.add(label as string),
    );
};

const press = (tree: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');

  if (!node) throw new Error(`No pressable labelled "${label}"`);
  ReactTestRenderer.act(() => node.props.onPress());
};

describe('WalletScreen', () => {
  describe('before the first sync', () => {
    test('says it is loading, and shows no figures it does not have', async () => {
      useCoinsStore.setState({ isSyncing: true });

      const tree = await render();
      const text = allText(tree);

      expect(
        tree.root.findAll(n => n.props?.accessibilityLabel === 'Loading')
          .length,
      ).toBeGreaterThan(0);
      expect(text).not.toContain('Lifetime');
      expect(text).not.toContain('No coins yet');
      // The shortcuts are not figures; they stay.
      expect(text).toContain('Coin History');
    });

    test('a first sync that failed offers to try again', async () => {
      useCoinsStore.setState({ syncError: 'No connection.' });
      const hydrate = jest.fn(async () => {});
      useCoinsStore.setState({ hydrateFromServer: hydrate });

      const tree = await render();
      expect(allText(tree)).toContain("Couldn't load your wallet");
      expect(allText(tree)).toContain('No connection.');

      const retry = tree.root
        .findAll(n => n.props?.label === 'Try again')
        .find(n => typeof n.props.onPress === 'function');
      if (!retry) throw new Error('No retry button');
      await ReactTestRenderer.act(async () => retry.props.onPress());

      expect(hydrate).toHaveBeenCalled();
    });
  });

  test('shows the balance and the lifetime pair that explains it', async () => {
    synced({ balance: 2_450, lifetimeEarned: 18_350 });

    const text = allText(await render());

    expect(text).toContain('2,450'); // balance
    expect(text).toContain('18,350'); // lifetime earned
    expect(text).toContain('15,900'); // lifetime spent, earned less held
  });

  test("the countdown is the server's", async () => {
    synced({ expiryDaysLeft: 37 });

    expect(allText(await render())).toContain('37');
  });

  test("the month's summary is the server's whole month", async () => {
    // The device only holds the newest fifty rows; the server's figure is
    // the whole month, and the screen never adds the rows up itself.
    synced({
      transactions: [tx('earned', 300, daysAgo(0))],
      monthSummary: { earned: 2_500, spent: 700, net: 1_800 },
    });

    expect(summaryFigures(await render())).toEqual([
      ['Earned', 2_500],
      ['Spent', 700],
      ['Balance', 1_800],
    ]);
  });

  test('shows only the newest four ledger rows', async () => {
    synced({
      transactions: [
        tx('r1', 10, daysAgo(0)),
        tx('r2', 20, daysAgo(1)),
        tx('r3', 30, daysAgo(2)),
        tx('r4', 40, daysAgo(3)),
        tx('r5', 50, daysAgo(4)),
      ],
    });

    const text = allText(await render());

    expect(text).toContain('Entry r4');
    expect(text).not.toContain('Entry r5');
  });

  test('the shop shortcut routes to the shop tab', async () => {
    synced();

    press(await render(), 'Shop. Spend your coins');

    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Shop' });
  });

  test('the earn action opens Referral & Earn', async () => {
    synced();

    press(await render(), 'Earn Coins. More ways to earn');

    expect(mockNavigate).toHaveBeenCalledWith('Referral');
  });

  test('an empty ledger says so instead of rendering a bare card', async () => {
    synced({ balance: 0, transactions: [] });

    expect(allText(await render())).toContain('No coins yet');
  });

  test('the history tile and the ledger\'s "View All" both open the coin history', async () => {
    synced();
    const tree = await render();

    press(tree, 'Coin History. All transactions');
    expect(mockNavigate).toHaveBeenCalledWith('CoinHistory');

    mockNavigate.mockClear();
    press(tree, 'View all transactions');
    expect(mockNavigate).toHaveBeenCalledWith('CoinHistory');
  });

  test('coins held for verification are shown next to the balance', async () => {
    synced({ pending: 23.75 });

    expect(allText(await render())).toContain('+23.75 pending verification');
  });

  test('nothing is said about pending coins when there are none', async () => {
    synced({ pending: 0 });

    expect(allText(await render())).not.toContain('pending verification');
  });

  test('a failed sync is admitted above the balance, and the figures stay', async () => {
    synced({ balance: 2_450, syncError: 'No connection.' });

    const text = allText(await render());
    expect(text).toContain("Couldn't refresh");
    expect(text).toContain('2,450');
  });

  test('the notice stays away while syncs are succeeding', async () => {
    synced({ syncError: null });

    expect(allText(await render())).not.toContain("Couldn't refresh");
  });

  describe('coin expiry', () => {
    test('a comfortable window keeps the calm advice', async () => {
      synced({ expiryDaysLeft: 80 });

      const text = allText(await render());
      expect(text).toContain('Stay active to keep your coins secure.');
    });

    test('inside the outer warn threshold the panel asks for coins soon', async () => {
      // 14 days before, like the server's first reminder (RULES E10).
      synced({ expiryDaysLeft: 14 });

      expect(allText(await render())).toContain(
        'Earn coins soon to keep them.',
      );
    });

    test('inside the inner threshold it says today', async () => {
      synced({ expiryDaysLeft: 3 });

      expect(allText(await render())).toContain(
        'Earn coins today or they expire.',
      );
    });

    test('an empty wallet has nothing to expire, whatever the countdown says', async () => {
      synced({ balance: 0, expiryDaysLeft: 2 });

      expect(allText(await render())).toContain(
        'Stay active to keep your coins secure.',
      );
    });

    test("the warnings follow the server's thresholds", async () => {
      synced({ expiryDaysLeft: 20, expiryWarnDays: [30, 7] });

      expect(allText(await render())).toContain(
        'Earn coins soon to keep them.',
      );
    });

    test('"About Coin Expiry" opens the explainer with the user\'s own numbers', async () => {
      synced({ balance: 1_240, expiryDaysLeft: 80 });
      const tree = await render();

      expect(allText(tree)).not.toContain('How coin expiry works');
      press(tree, 'About coin expiry');

      const text = allText(tree);
      expect(text).toContain('How coin expiry works');
      expect(text).toContain('80 days left');
      expect(text).toContain('Your 1,240 coins are safe until');
      expect(text).toContain('a fresh 90 days');
      expect(text).toContain('14 days and 3 days before');
    });

    test('the "?" on the label opens the same explainer', async () => {
      synced();
      const tree = await render();

      press(tree, 'Coins Expiry, what is this?');

      expect(allText(tree)).toContain('How coin expiry works');
    });

    test("the explainer is worded from the server's window", async () => {
      synced({
        expiryDaysLeft: 60,
        expiresAt: new Date(Date.now() + 60 * DAY_MS).toISOString(),
        expiryWindowDays: 60,
        expiryWarnDays: [7],
      });
      const tree = await render();

      press(tree, 'About coin expiry');

      const text = allText(tree);
      expect(text).toContain('a fresh 60 days');
      expect(text).toContain('7 days before');
      expect(text).not.toContain('90');
    });

    test('an empty wallet is told there is nothing to expire yet', async () => {
      synced({ balance: 0, transactions: [], expiresAt: null });
      const tree = await render();

      press(tree, 'About coin expiry');

      expect(allText(tree)).toContain('Nothing to expire yet');
    });

    test('"Earn coins" in the explainer closes it and opens Referral & Earn', async () => {
      synced();
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

  describe('"Your Coins" explainer', () => {
    test('opens from the "?" on the balance label with the served rate card', async () => {
      synced({
        earnRules: [
          {
            source: 'steps',
            title: 'Walk',
            detail: 'Per 100 verified steps',
            reward: 0.095,
          },
          {
            source: 'referral',
            title: 'Invite a friend',
            detail: 'Once they verify',
            reward: 20,
          },
        ],
        dailyCap: 300,
        earnedToday: 60,
        remainingToday: 240,
      });
      const tree = await render();

      expect(allText(tree)).not.toContain('Ways to earn');
      press(tree, 'Your Coins, what is this?');

      const text = allText(tree);
      expect(text).toContain('Ways to earn');
      expect(text).toContain('Per 100 verified steps');
      expect(text).toContain('Once they verify');
      expect(text).toContain('Up to 300 coins a day');
      expect(text).toContain('60 earned so far today, 240 still to go');
    });

    test('with no rate card cached it says the rates are still to load, rather than inventing them', async () => {
      synced({ earnRules: null });
      const tree = await render();

      press(tree, 'Your Coins, what is this?');

      const text = allText(tree);
      expect(text).toContain(
        'The current rates load the next time you are online.',
      );
      expect(text).not.toContain('Per 1,000 steps');
    });

    test('a day at the cap says so, and when it resets', async () => {
      synced({ dailyCap: 300, earnedToday: 300, remainingToday: 0 });
      const tree = await render();

      press(tree, 'Your Coins, what is this?');

      const text = allText(tree);
      expect(text).toContain('Daily limit reached');
      expect(text).toContain('resets at midnight');
    });

    test('"Spend in the shop" closes it and opens the shop tab', async () => {
      synced();
      const tree = await render();
      press(tree, 'Your Coins, what is this?');

      const shop = tree.root
        .findAll(n => n.props?.label === 'Spend in the shop')
        .find(n => typeof n.props.onPress === 'function');
      if (!shop) throw new Error('No shop button');
      ReactTestRenderer.act(() => shop.props.onPress());

      expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Shop' });
    });
  });
});
