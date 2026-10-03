/**
 * The leaderboard screen states the same prize twice — once as a tier rule and
 * once as the coins a named person is taking this week — so the checks here are
 * that those two agree, that the tab param decides which half opens without
 * then overriding the user, that the balance in the header is the live one,
 * and that every card waits for the server rather than inventing figures. The
 * API is the mock backend's own, served without latency.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { LeaderboardRewardsScreen } from '../src/screens/main/LeaderboardRewardsScreen';
import { ThemeProvider } from '../src/theme';
import { useCoinsStore } from '../src/stores/coinsStore';
import { seedLeaderboard } from '../src/constants/seedData';
import { clearServerReads } from '../src/hooks/useServerRead';
import { mockLeaderboardApi } from '../src/services/api/mockApi';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockParams: { tab?: 'rewards' | 'how' } | undefined;

// Only the two hooks are replaced: the theme layer imports `DefaultTheme` from
// this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: mockParams }),
}));

// Latency is what makes spinners visible in the app and slow in a test suite.
jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    mockLatencyMs: 0,
  },
}));

// The mock backend's own answers, behind spies a test can redirect.
jest.mock('../src/services/api/endpoints', () => {
  const { mockLeaderboardApi: api } = jest.requireActual(
    '../src/services/api/mockApi',
  );
  return {
    leaderboardApi: {
      board: jest.fn(() => api.board()),
      history: jest.fn(() => api.history()),
      rules: jest.fn(() => api.rules()),
    },
  };
});

const { leaderboardApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  leaderboardApi: { board: jest.Mock; history: jest.Mock; rules: jest.Mock };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockParams = undefined;
  clearServerReads();
  useCoinsStore.setState({
    balance: 650,
    lifetimeEarned: 650,
    transactions: [],
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

/** Lets the server's answers land. */
const settle = () =>
  ReactTestRenderer.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  });

const render = async ({ wait = true } = {}) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <LeaderboardRewardsScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  if (wait) await settle();
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

const press = (tree: ReactTestRenderer.ReactTestRenderer, prefix: string) => {
  const node = tree.root
    .findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        (n.props.accessibilityLabel as string).startsWith(prefix),
    )
    .find(n => typeof n.props.onPress === 'function');

  if (!node) throw new Error(`No pressable labelled "${prefix}…"`);
  ReactTestRenderer.act(() => node.props.onPress());
};

describe('LeaderboardRewardsScreen', () => {
  test('each card waits for its answer, and invents no prize or place', async () => {
    leaderboardApi.rules.mockReturnValueOnce(new Promise(() => {}));
    leaderboardApi.board.mockReturnValueOnce(new Promise(() => {}));
    leaderboardApi.history.mockReturnValueOnce(new Promise(() => {}));
    const tree = await render({ wait: false });

    expect(
      tree.root.findAll(n => n.props?.accessibilityLabel === 'Loading').length,
    ).toBeGreaterThanOrEqual(3);
    const text = allText(tree);
    expect(text).not.toContain('Rank 1');
    expect(text).not.toContain('Rahul Verma');
  });

  test('a board that failed to load offers to try again', async () => {
    leaderboardApi.board.mockRejectedValueOnce(new Error('offline'));
    const tree = await render();

    expect(allText(tree)).toContain("Couldn't load the board");
    // The prizes came back on their own.
    expect(allText(tree)).toContain('Rank 1');
  });

  test('the header states the balance the prizes are paid in', async () => {
    expect(allText(await render())).toContain('650');
  });

  test('each tier states the coins and the gear it pays', async () => {
    const text = allText(await render());

    expect(text).toContain('Rank 1');
    expect(text).toContain('+ Premium T-Shirt');
    expect(text).toContain('Rank 4 – 10');
    // The figure and its unit are separate text nodes inside one line, which
    // the collector joins with a space — matched loosely rather than asserting
    // on how the two happen to be split.
    expect(text).toMatch(/5,000\s+Coins/);
    expect(text).toMatch(/1,000\s+Coins/);
  });

  test("this week's board pays what the tiers promise", async () => {
    const text = allText(await render());

    // Whoever holds first place takes the first tier's coins; a board that
    // disagreed with the table above it would be the screen's worst bug.
    const first = seedLeaderboard.find(entry => entry.rank === 1);
    const rules = await mockLeaderboardApi.rules();
    expect(first?.coins).toBe(rules.tiers[0].coins);
    expect(text).toContain('Rahul Verma');
    expect(text).toContain('Delhi, India');
  });

  test('the user is told their own place when it is below the top five', async () => {
    expect(allText(await render())).toContain(
      'You are #12 this week with 1,240 points.',
    );
  });

  test('the rankings strip states the user own record', async () => {
    const text = allText(await render());

    expect(text).toContain('Your Best Rankings');
    expect(text).toContain('2,350');
  });

  test('the rules live behind the second tab, not on the prize page', async () => {
    const tree = await render();

    expect(allText(tree)).not.toContain('How the leaderboard works');

    press(tree, 'How It Works');

    const text = allText(tree);
    expect(text).toContain('How the leaderboard works');
    expect(text).toContain('Rewards land on Monday');
    // The prize table is put away rather than left under the rules.
    expect(text).not.toContain('Leaderboard Reward Tiers');
  });

  test('a link can open the rules directly', async () => {
    mockParams = { tab: 'how' };

    expect(allText(await render())).toContain('How the leaderboard works');
  });

  test('the tab the param chose can still be switched away from', async () => {
    mockParams = { tab: 'how' };
    const tree = await render();

    press(tree, 'Rewards & Prizes');

    expect(allText(tree)).toContain('Leaderboard Reward Tiers');
  });

  test('the chevron returns to whatever opened the board', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
