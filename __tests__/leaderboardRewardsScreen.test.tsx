/**
 * The leaderboard screen states the same prize twice — once as a tier rule and
 * once as the coins a named person is taking this week — so the checks here are
 * that those two agree, that the tab param decides which half opens without
 * then overriding the user, and that the balance in the header is the live one.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { LeaderboardRewardsScreen } from '../src/screens/main/LeaderboardRewardsScreen';
import { REWARD_TIERS } from '../src/components/leaderboard/RewardTiersCard';
import { ThemeProvider } from '../src/theme';
import { useCoinsStore } from '../src/stores/coinsStore';
import { seedLeaderboard } from '../src/constants/seedData';

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

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockParams = undefined;
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

const render = async () => {
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
    expect(first?.coins).toBe(REWARD_TIERS[0].coins);
    expect(text).toContain('Rahul Verma');
    expect(text).toContain('Delhi, India');
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
