/**
 * The board in full — and the fact that "in full" is the top 50 places, a
 * page at a time (RULES L2b, D-90).
 *
 * Ranking a whole country would be a list nobody scrolls and a query that
 * grows with the member count, and every place that pays is inside the first
 * fifty. So the screen asks for a page, says how many are scoring beyond what
 * it holds, and only offers "Show more" while the server says there is more.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { clearServerReads } from '../src/hooks/useServerRead';
import { LeaderboardBoardScreen } from '../src/screens/main/LeaderboardBoardScreen';
import { mockLeaderboardApi } from '../src/services/api/mockApi';
import { ThemeProvider } from '../src/theme';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
}));

// Latency is what makes spinners visible in the app and slow in a suite.
jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    mockLatencyMs: 0,
  },
}));

jest.mock('../src/services/steps', () => ({
  syncStepsNow: jest.fn(async () => {}),
}));

jest.mock('../src/services/api/endpoints', () => {
  const { mockLeaderboardApi: api } = jest.requireActual(
    '../src/services/api/mockApi',
  );
  return {
    leaderboardApi: {
      board: jest.fn((page?: { offset?: number; limit?: number }) =>
        api.board(page),
      ),
    },
  };
});

const { leaderboardApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  leaderboardApi: { board: jest.Mock };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockGoBack.mockClear();
  mockNavigate.mockClear();
  leaderboardApi.board.mockClear();
  clearServerReads();
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
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <LeaderboardBoardScreen />
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
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
};

describe('LeaderboardBoardScreen', () => {
  test('asks for a page rather than the whole board', async () => {
    await render();

    expect(leaderboardApi.board).toHaveBeenCalledWith({ limit: 20 });
  });

  test('“Show more” asks for the next page', async () => {
    // The mock's own board is twelve rows, so one page is all of it. A real
    // board with ninety-six scoring says there is more, which is the case
    // this is about.
    leaderboardApi.board.mockImplementation(
      async (page?: { limit?: number }) => ({
        ...(await mockLeaderboardApi.board(page)),
        hasMore: true,
      }),
    );
    const tree = await render();
    expect(allText(tree)).toContain('Show more');

    await press(tree, 'Show more places');

    expect(leaderboardApi.board).toHaveBeenLastCalledWith({ limit: 40 });
  });

  test('the button goes once the board has no more places to give', async () => {
    // The board is the top fifty; a server that says `hasMore: false` is the
    // end of it, and the screen must not offer a page that does not exist.
    leaderboardApi.board.mockImplementation(async () => ({
      ...(await mockLeaderboardApi.board()),
      hasMore: false,
    }));

    expect(allText(await render())).not.toContain('Show more');
  });

  test('it says how many are scoring beyond the places it holds', async () => {
    const text = allText(await render());

    // 96 ranked in the mock against a board of fifty: the list is not
    // everyone, and the screen says so rather than implying it is.
    expect(text).toContain('96 ranked');
    expect(text).toContain('more ranked below the places shown');
  });

  test('a board that failed to load offers to try again', async () => {
    leaderboardApi.board.mockRejectedValueOnce(new Error('offline'));

    expect(allText(await render())).toContain("Couldn't load the board");
  });
});
