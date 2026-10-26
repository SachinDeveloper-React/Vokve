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
    expect(text).not.toContain('1st Place');
    expect(text).not.toContain('Rahul Verma');
  });

  test('a board that failed to load offers to try again', async () => {
    leaderboardApi.board.mockRejectedValueOnce(new Error('offline'));
    const tree = await render();

    expect(allText(tree)).toContain("Couldn't load the board");
    // The prizes came back on their own.
    expect(allText(tree)).toContain('1st Place');
  });

  test('a rung is labelled in the operator’s words, or by its ranks', async () => {
    const text = allText(await render());

    // ⚙ `leaderboard.tiers[].label` where somebody wrote one (D-89) — the
    // app draws the server's word, not a sentence of its own.
    expect(text).toContain('1st Place');
    // And the server's derived label where nobody did, which is correct and
    // never what marketing would have written.
    expect(text).toContain('Rank 2 – 3');
  });

  test('the banner is the server’s words, and this build’s before they land', async () => {
    const withServer = allText(await render());
    expect(withServer).toContain('Win Amazing Rewards!');

    // A server older than the field sends no banner at all; the screen still
    // has a banner (⚙ `leaderboard.banner`, D-89).
    leaderboardApi.rules.mockImplementationOnce(async () => ({
      ...(await mockLeaderboardApi.rules()),
      banner: undefined,
    }));
    expect(allText(await render())).toContain('Win Amazing Rewards!');
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
      'You are #14 this week with 1,240 points.',
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

  test('"View Full Leaderboard" opens the board in full', async () => {
    const tree = await render();
    press(tree, 'View full leaderboard');

    expect(mockNavigate).toHaveBeenCalledWith('LeaderboardBoard');
  });

  test('the chevron returns to whatever opened the board', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});

/**
 * "Did I get the coins, or not?" (D-90)
 *
 * The one question the screen could not answer: a place that pays and a zero
 * beside it are the same row until something says why. Every state and every
 * sentence here is the server's — the app only draws them — so these checks
 * are that it draws all four and never invents one.
 */
describe('LeaderboardRewardsScreen: the weeks', () => {
  test('each closed week says where it placed, what was paid, and why', async () => {
    const text = allText(await render());

    expect(text).toContain('Your Weeks');
    // Paid: the figure and the server's own sentence.
    expect(text).toContain('5,000 coins are in your wallet.');
    // Won and not paid — the figure shown is what was *paid*, with the
    // reason beside it rather than a bare zero.
    expect(text).toContain('Not paid');
    expect(text).toContain('leaderboard prizes were not running');
    // Below the ladder.
    expect(text).toContain('Only the top 10 places win coins');
    // And the total that was won and never credited.
    expect(text).toContain('3,000');
  });

  test('it says every week is paid on its own — the repeat-win question', async () => {
    const text = allText(await render());

    // A member who won at #1, slipped to #18 and came back has no way to
    // know whether the prize pays twice. It does; the card says so and the
    // list shows it week by week.
    expect(text).toContain('Every week is paid on its own');
    expect(text).toContain('#1');
    expect(text).toContain('#18');
  });

  test('a member with no closed week is told what would record one', async () => {
    leaderboardApi.history.mockImplementationOnce(async () => ({
      ...(await mockLeaderboardApi.history()),
      periods: [],
      rewardCoinsHeld: 0,
    }));

    expect(allText(await render())).toContain('No week has closed with you');
  });

  test('the card under the prize table asks for five places, not fifty', async () => {
    await render();

    // It illustrates the ladder above it; the board itself is a tap away.
    // Taking fifty rows to draw five is a page of the board nobody reads.
    expect(leaderboardApi.board).toHaveBeenCalledWith({ limit: 5 });
  });
});

/**
 * The row the crash came from.
 *
 * `state`, `reason`, `won` and `perks` arrived with the weeks card, and the
 * answers cache keeps a payload past the end of the process and hands it
 * back as it was written — the schema defaults only ever ran on the way in.
 * So the first launch of the new build read a week with none of those fields
 * and `perks.length` took the screen down. The cache is stamped with the
 * build that wrote it now, and the row reads defensively regardless: this is
 * the second belt, and the one that would have kept the screen up.
 */
test('a week stored by an older build draws rather than crashes', async () => {
  leaderboardApi.history.mockImplementationOnce(
    async () =>
      ({
        ...(await mockLeaderboardApi.history()),
        rewardCoinsHeld: undefined,
        periods: [
          // Exactly the old shape: a place, a score, what was credited, and
          // nothing about what it won or why.
          {
            id: '2026-10-12',
            start: '2026-10-12',
            end: '2026-10-18',
            rank: 1,
            score: 2_480,
            coins: 5_000,
          },
        ],
      } as never),
  );

  const text = allText(await render());

  expect(text).toContain('Your Weeks');
  expect(text).toContain('#1');
  // Nothing is claimed about an outcome the row was never told.
  expect(text).toContain('No prize');
});
