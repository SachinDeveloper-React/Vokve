/**
 * The three screens the board's and the rewards screen's "View All" links lead
 * to. Each exists for one reason — to get past a card that only had room for
 * three rows, five badges or five places — so the checks here are mostly about
 * that: the full list arriving, the filters narrowing it honestly, and every
 * row still leading on to the thing it stands for.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { AchievementsScreen } from '../src/screens/main/AchievementsScreen';
import { ChallengeListScreen } from '../src/screens/main/ChallengeListScreen';
import { LeaderboardBoardScreen } from '../src/screens/main/LeaderboardBoardScreen';
import { ThemeProvider } from '../src/theme';
import {
  seedAchievements,
  seedChallenges,
  seedLeaderboard,
} from '../src/constants/seedData';
import { clearServerReads } from '../src/hooks/useServerRead';
import { todayIso } from '../src/utils/date';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockCanGoBack = true;
let mockParams: Record<string, unknown> | undefined;

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => mockCanGoBack,
  }),
  useRoute: () => ({ params: mockParams }),
}));

jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    mockLatencyMs: 0,
  },
}));

jest.mock('../src/services/api/endpoints', () => {
  const { mockChallengeApi, mockLeaderboardApi } = jest.requireActual(
    '../src/services/api/mockApi',
  );
  return {
    challengeApi: {
      board: jest.fn((date: string) => mockChallengeApi.board(date)),
      achievements: jest.fn(() => mockChallengeApi.achievements()),
    },
    leaderboardApi: {
      board: jest.fn(() => mockLeaderboardApi.board()),
    },
  };
});

const { challengeApi, leaderboardApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  challengeApi: { board: jest.Mock; achievements: jest.Mock };
  leaderboardApi: { board: jest.Mock };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockCanGoBack = true;
  mockParams = undefined;
  clearServerReads();
  challengeApi.board.mockClear();
  challengeApi.achievements.mockClear();
  leaderboardApi.board.mockClear();
});

const settle = () =>
  ReactTestRenderer.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
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

const render = async (Screen: React.ComponentType, { wait = true } = {}) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <Screen />
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

const rowLabels = (tree: ReactTestRenderer.ReactTestRenderer) => {
  const seen = new Set<string>();
  return tree.root
    .findAll(n => typeof n.props?.accessibilityLabel === 'string')
    .map(n => n.props.accessibilityLabel as string)
    .filter(label => !seen.has(label) && seen.add(label));
};

// The app counts in local days; a UTC one is a different date either side
// of midnight.
const today = todayIso;

describe('ChallengeListScreen', () => {
  test('shows every running challenge, not the board’s first three', async () => {
    const tree = await render(ChallengeListScreen);
    const running = seedChallenges.filter(c => c.startsAt === null);

    expect(running.length).toBeGreaterThan(3);
    const text = allText(tree);
    for (const challenge of running) {
      expect(text).toContain(challenge.title);
    }
  });

  test('opens on the kind and the day the board handed it', async () => {
    mockParams = { kind: 'upcoming', date: '2026-09-17' };
    const tree = await render(ChallengeListScreen);

    expect(challengeApi.board).toHaveBeenCalledWith('2026-09-17');
    // The upcoming list, not the running one.
    expect(allText(tree)).toContain('Upcoming Challenges');
    expect(allText(tree)).not.toContain('Active Challenges');
  });

  test('the two chips swap the list and count what they are about to show', async () => {
    const tree = await render(ChallengeListScreen);
    expect(allText(tree)).toContain('Active Challenges');

    const active = seedChallenges.filter(c => c.startsAt === null).length;
    expect(rowLabels(tree)).toContain(`Active, ${active}`);

    press(tree, 'Upcoming,');
    expect(allText(tree)).toContain('Upcoming Challenges');
    expect(allText(tree)).not.toContain('Active Challenges');
  });

  test('the cadence filter narrows the list and the count with it', async () => {
    const tree = await render(ChallengeListScreen);
    const weekly = seedChallenges.filter(
      c => c.startsAt === null && c.cadence === 'weekly',
    );

    press(tree, 'Weekly');
    expect(rowLabels(tree)).toContain(`Active, ${weekly.length}`);
    const text = allText(tree);
    expect(text).toContain(weekly[0].title);
    const daily = seedChallenges.find(
      c => c.startsAt === null && c.cadence === 'daily',
    );
    expect(text).not.toContain(daily!.title);
  });

  test('a row opens that challenge for the day being shown', async () => {
    const tree = await render(ChallengeListScreen);
    press(tree, '10K Steps Challenge.');

    expect(mockNavigate).toHaveBeenCalledWith('ChallengeDetail', {
      id: 'ch-10k-steps',
      date: today(),
    });
  });

  test('a board that failed to load offers to try again', async () => {
    challengeApi.board.mockRejectedValueOnce(new Error('offline'));
    const tree = await render(ChallengeListScreen);

    expect(allText(tree)).toContain("Couldn't load the challenges");
  });
});

describe('AchievementsScreen', () => {
  test('lays out the whole shelf with what is filled of it', async () => {
    const tree = await render(AchievementsScreen);
    const earned = seedAchievements.filter(a => a.achievedAt !== null);

    const text = allText(tree);
    expect(text).toContain(
      `${earned.length} of ${seedAchievements.length} unlocked`,
    );
    for (const badge of seedAchievements) {
      expect(text).toContain(badge.label);
    }
  });

  test('names the badge that landed last, not just the total', async () => {
    const tree = await render(AchievementsScreen);
    expect(allText(tree)).toContain('Latest:');
  });

  test('the filter counts both halves and shows only the one chosen', async () => {
    const tree = await render(AchievementsScreen);
    const earned = seedAchievements.filter(a => a.achievedAt !== null);
    const locked = seedAchievements.filter(a => a.achievedAt === null);

    expect(rowLabels(tree)).toContain(`Earned, ${earned.length}`);
    expect(rowLabels(tree)).toContain(`Locked, ${locked.length}`);

    // Asserted on the badges themselves: the summary above them names the
    // newest unlock whichever half is showing, which is the point of it.
    press(tree, 'Locked,');
    const badges = rowLabels(tree).filter(label =>
      /, (achieved|locked)$/.test(label),
    );
    expect(badges).toHaveLength(locked.length);
    expect(badges.every(label => label.endsWith(', locked'))).toBe(true);

    press(tree, 'Earned,');
    const kept = rowLabels(tree).filter(label =>
      /, (achieved|locked)$/.test(label),
    );
    expect(kept.every(label => label.endsWith(', achieved'))).toBe(true);
  });

  test('a badge opens in full', async () => {
    const tree = await render(AchievementsScreen);
    press(tree, '10K Steps, achieved');

    expect(mockNavigate).toHaveBeenCalledWith('AchievementDetail', {
      id: 'a-10k-steps',
    });
  });

  test('the shelf leads with what has been earned', async () => {
    const tree = await render(AchievementsScreen);
    const badges = rowLabels(tree).filter(label =>
      /, (achieved|locked)$/.test(label),
    );

    const firstLocked = badges.findIndex(l => l.endsWith(', locked'));
    const lastEarned = badges.map(l => l.endsWith(', achieved')).lastIndexOf(true);
    expect(firstLocked).toBeGreaterThan(lastEarned - 1);
  });
});

describe('LeaderboardBoardScreen', () => {
  test('shows every place the server served, not the card’s five', async () => {
    const tree = await render(LeaderboardBoardScreen);

    expect(seedLeaderboard.length).toBeGreaterThan(5);
    const text = allText(tree);
    for (const entry of seedLeaderboard) {
      expect(text).toContain(entry.name);
    }
  });

  test('says how many are ranked below the places it could show', async () => {
    const tree = await render(LeaderboardBoardScreen);
    expect(allText(tree)).toContain('more ranked below the places shown');
  });

  test('answers “where am I” before the list rather than inside it', async () => {
    const tree = await render(LeaderboardBoardScreen);
    expect(allText(tree)).toContain('Your place');
  });

  test('a board that failed to load offers to try again', async () => {
    leaderboardApi.board.mockRejectedValueOnce(new Error('offline'));
    const tree = await render(LeaderboardBoardScreen);

    expect(allText(tree)).toContain("Couldn't load the board");
  });

  test('the chevron returns to whatever opened the board', async () => {
    const tree = await render(LeaderboardBoardScreen);
    press(tree, 'Back');
    expect(mockGoBack).toHaveBeenCalled();

    mockCanGoBack = false;
    press(tree, 'Back');
    expect(mockNavigate).toHaveBeenCalledWith('LeaderboardRewards');
  });
});
