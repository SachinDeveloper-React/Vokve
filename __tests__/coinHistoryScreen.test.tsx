/**
 * The coin history is the one screen that pages from the server, so the checks
 * here are about that: the first page paints, the next one appends rather than
 * replaces, a filter starts a fresh list, a failed page is admitted with a way
 * to try again, and a stale answer for a filter the user has already left
 * never lands in the list.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { CoinHistoryScreen } from '../src/screens/main/CoinHistoryScreen';
import { ThemeProvider } from '../src/theme';
import { useCoinsStore } from '../src/stores/coinsStore';
import { COIN_HISTORY_PAGE_SIZE } from '../src/hooks/useCoinHistory';
import type { CoinTransaction } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { source?: CoinTransaction['source'] } | undefined;

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../src/services/api/endpoints', () => ({
  walletApi: {
    get: jest.fn(),
    transactions: jest.fn(),
    earnRules: jest.fn(),
  },
}));

const { walletApi } = jest.requireMock('../src/services/api/endpoints') as {
  walletApi: { transactions: jest.Mock };
};

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

/** A page the way the server sends one. */
const page = (data: CoinTransaction[], nextCursor: string | null = null) => ({
  data,
  nextCursor,
});

/** Lets a test hold a response back until it decides the order of arrival. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockRouteParams = undefined;
  walletApi.transactions.mockReset();
  useCoinsStore.setState({ transactions: [], balance: 0 });
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

/** Lets every promise queued so far settle, so a mocked page can land. */
const settle = () =>
  ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <CoinHistoryScreen />
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

const press = (tree: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');

  if (!node) throw new Error(`No pressable labelled "${label}"`);
  ReactTestRenderer.act(() => node.props.onPress());
};

/** The list itself, so a test can reach the end of it. */
const list = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll(n => typeof n.props?.onEndReached === 'function')[0];

describe('CoinHistoryScreen', () => {
  test('asks the server for the first page and files the rows under their days', async () => {
    walletApi.transactions.mockResolvedValue(
      page([
        tx('a', 60, daysAgo(0)),
        tx('b', -450, daysAgo(1), 'purchase'),
        tx('c', 100, daysAgo(1), 'workout'),
      ]),
    );

    const text = allText(await render());

    expect(walletApi.transactions).toHaveBeenCalledWith({
      cursor: undefined,
      limit: COIN_HISTORY_PAGE_SIZE,
      source: undefined,
    });
    expect(text).toContain('Today');
    expect(text).toContain('Yesterday');
    expect(text).toContain('Entry a');
    expect(text).toContain('Entry c');
  });

  test("paints the wallet's cached rows before the server answers", async () => {
    useCoinsStore.setState({ transactions: [tx('cached', 10, daysAgo(0))] });
    walletApi.transactions.mockReturnValue(new Promise(() => {}));

    expect(allText(await render())).toContain('Entry cached');
  });

  test('reaching the end fetches the next page and appends it', async () => {
    walletApi.transactions
      .mockResolvedValueOnce(page([tx('p1', 10, daysAgo(0))], 'p1'))
      .mockResolvedValueOnce(page([tx('p2', 20, daysAgo(3))], null));

    const tree = await render();
    expect(allText(tree)).toContain('Entry p1');

    await ReactTestRenderer.act(async () => {
      list(tree).props.onEndReached();
    });
    await settle();

    expect(walletApi.transactions).toHaveBeenLastCalledWith({
      cursor: 'p1',
      limit: COIN_HISTORY_PAGE_SIZE,
      source: undefined,
    });
    const text = allText(tree);
    expect(text).toContain('Entry p1');
    expect(text).toContain('Entry p2');
  });

  test('the last page is the end: nothing more is asked for', async () => {
    walletApi.transactions.mockResolvedValue(
      page([tx('a', 10, daysAgo(0))], null),
    );

    const tree = await render();
    await ReactTestRenderer.act(async () => {
      list(tree).props.onEndReached();
    });
    await settle();

    expect(walletApi.transactions).toHaveBeenCalledTimes(1);
  });

  test('picking a source starts a fresh, filtered list from the top', async () => {
    walletApi.transactions
      .mockResolvedValueOnce(page([tx('all', 10, daysAgo(0))]))
      .mockResolvedValueOnce(page([tx('w', 100, daysAgo(0), 'workout')]));

    const tree = await render();
    expect(allText(tree)).toContain('Entry all');

    press(tree, 'Workouts');
    await settle();

    expect(walletApi.transactions).toHaveBeenLastCalledWith({
      cursor: undefined,
      limit: COIN_HISTORY_PAGE_SIZE,
      source: 'workout',
    });
    const text = allText(tree);
    expect(text).toContain('Entry w');
    expect(text).not.toContain('Entry all');
  });

  test('a page that arrives for a filter the user has left is thrown away', async () => {
    const slow = deferred<ReturnType<typeof page>>();
    walletApi.transactions
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(page([tx('w', 100, daysAgo(0), 'workout')]));

    const tree = await render();
    press(tree, 'Workouts');
    await settle();
    expect(allText(tree)).toContain('Entry w');

    // The unfiltered page lands late. It belongs to a list that no longer
    // exists, so the workouts list must not gain a steps row.
    await ReactTestRenderer.act(async () => {
      slow.resolve(page([tx('late', 5, daysAgo(0))]));
    });
    await settle();

    const text = allText(tree);
    expect(text).toContain('Entry w');
    expect(text).not.toContain('Entry late');
  });

  test('opens already filtered when the route says which source', async () => {
    mockRouteParams = { source: 'referral' };
    walletApi.transactions.mockResolvedValue(page([]));

    await render();

    expect(walletApi.transactions).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'referral' }),
    );
  });

  test('a failed first page is admitted, and "Try again" asks once more', async () => {
    walletApi.transactions
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce(page([tx('ok', 10, daysAgo(0))]));

    const tree = await render();
    expect(allText(tree)).toContain("Couldn't load your history");

    const retry = tree.root
      .findAll(n => n.props?.label === 'Try again')
      .find(n => typeof n.props.onPress === 'function');
    if (!retry) throw new Error('No retry button');
    await ReactTestRenderer.act(async () => {
      retry.props.onPress();
    });
    await settle();

    expect(walletApi.transactions).toHaveBeenCalledTimes(2);
    expect(allText(tree)).toContain('Entry ok');
  });

  test('a failed later page keeps the rows already shown and offers a retry', async () => {
    walletApi.transactions
      .mockResolvedValueOnce(page([tx('p1', 10, daysAgo(0))], 'p1'))
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce(page([tx('p2', 20, daysAgo(2))], null));

    const tree = await render();
    await ReactTestRenderer.act(async () => {
      list(tree).props.onEndReached();
    });
    await settle();

    const text = allText(tree);
    expect(text).toContain('Entry p1');
    expect(text).toContain('Try again');
    expect(text).not.toContain("Couldn't load your history");

    // The list re-measures when its footer changes and fires end-reached
    // again. That must not become a request loop against a dead network.
    await ReactTestRenderer.act(async () => {
      list(tree).props.onEndReached();
    });
    await settle();
    expect(walletApi.transactions).toHaveBeenCalledTimes(2);

    // Only the user asks again — and it is the same page that failed.
    const retry = tree.root
      .findAll(n => n.props?.label === 'Try again')
      .find(n => typeof n.props.onPress === 'function');
    if (!retry) throw new Error('No retry button');
    await ReactTestRenderer.act(async () => {
      retry.props.onPress();
    });
    await settle();

    expect(walletApi.transactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'p1' }),
    );
    expect(allText(tree)).toContain('Entry p2');
  });

  test('an empty ledger says so, in the words of the filter', async () => {
    walletApi.transactions.mockResolvedValue(page([]));

    const tree = await render();
    expect(allText(tree)).toContain('No coins yet');

    press(tree, 'Refunds');
    await settle();
    expect(allText(tree)).toContain('Nothing here yet');
  });

  test('the chevron goes back to the wallet', async () => {
    walletApi.transactions.mockResolvedValue(page([]));

    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalled();
  });
});
