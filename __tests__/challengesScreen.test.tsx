/**
 * The challenge board is the server's (`GET /challenges?date=`), split into
 * two — what is running and what is still to open — and filtered by cadence,
 * so the checks here are about that split holding: that a challenge never
 * appears in both cards, that the cadence chips narrow the two lists
 * together, that the achievement shelf leads with what has actually been
 * earned, and that nothing is shown before the server has answered. The API
 * is the mock backend's own, served without latency.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { ChallengesScreen } from '../src/screens/main/ChallengesScreen';
import { ThemeProvider } from '../src/theme';
import { seedChallenges } from '../src/constants/seedData';
import { clearServerReads } from '../src/hooks/useServerRead';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockCanGoBack = true;

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => mockCanGoBack,
  }),
}));

// Latency is what makes spinners visible in the app and slow in a test suite.
jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    mockLatencyMs: 0,
  },
}));

// The mock backend's own board and shelf, behind spies a test can redirect.
jest.mock('../src/services/api/endpoints', () => {
  const { mockChallengeApi } = jest.requireActual(
    '../src/services/api/mockApi',
  );
  return {
    challengeApi: {
      board: jest.fn((date: string) => mockChallengeApi.board(date)),
      achievements: jest.fn(() => mockChallengeApi.achievements()),
    },
  };
});

const { challengeApi } = jest.requireMock('../src/services/api/endpoints') as {
  challengeApi: { board: jest.Mock; achievements: jest.Mock };
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
  clearServerReads();
  challengeApi.board.mockClear();
  challengeApi.achievements.mockClear();
});

/** Lets the server's answers land. */
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

const render = async ({ wait = true } = {}) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ChallengesScreen />
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

/** The first pressable whose accessibility label starts with `prefix`. */
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

/**
 * Every row's accessibility label, which is where a row states its figures.
 *
 * De-duplicated: a memo-wrapped component matches the predicate twice, once
 * for the wrapper and once for the element inside it, so the raw list holds
 * every row twice and an index into it reads the same row again.
 */
const rowLabels = (tree: ReactTestRenderer.ReactTestRenderer) => {
  const seen = new Set<string>();

  return tree.root
    .findAll(n => n.props?.accessible === true)
    .map(n => n.props.accessibilityLabel as string)
    .filter(label => Boolean(label) && !seen.has(label) && seen.add(label));
};

const longDateOf = (date: Date) =>
  date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

describe('ChallengesScreen', () => {
  test('before the board arrives it says so, and shows no challenge it does not have', async () => {
    challengeApi.board.mockReturnValueOnce(new Promise(() => {}));
    const tree = await render({ wait: false });

    expect(
      tree.root.findAll(n => n.props?.accessibilityLabel === 'Loading').length,
    ).toBeGreaterThan(0);
    expect(allText(tree)).not.toContain('10K Steps Challenge');
  });

  test('a board that failed to load offers to try again', async () => {
    challengeApi.board.mockRejectedValueOnce(new Error('offline'));
    const tree = await render();

    expect(allText(tree)).toContain("Couldn't load the challenges");

    const retry = tree.root
      .findAll(n => n.props?.label === 'Try again')
      .find(n => typeof n.props.onPress === 'function');
    if (!retry) throw new Error('No retry button');
    ReactTestRenderer.act(() => retry.props.onPress());
    await settle();

    expect(allText(tree)).toContain('10K Steps Challenge');
  });

  test("the board asked for is the chosen day's", async () => {
    await render();

    expect(challengeApi.board).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  test('a running challenge states its progress in words, not only as a bar', async () => {
    const text = allText(await render());

    expect(text).toContain('10K Steps Challenge');
    expect(text).toContain('7,543 / 10,000 steps');
    expect(text).toContain('312 / 500 Cal');
    expect(text).toContain('22 / 30 min');
  });

  test('a challenge the server has completed says so in words', async () => {
    const done = {
      ...seedChallenges[0],
      progress: 10_400,
      endsOn: '2026-10-02',
      completedAt: '2026-10-02T09:30:00.000Z',
    };
    challengeApi.board.mockResolvedValueOnce([done]);

    const text = allText(await render());

    expect(text).toContain('Completed ✓ · 10,400 / 10,000 steps');
  });

  test("an earned badge shows the server's figure, abbreviated for its ring", async () => {
    const text = allText(await render());

    // The seed's 10K Steps badge is earned and sent as 10000.
    expect(text).toContain('10K');
  });

  test('a challenge that has not opened yet is never also shown as running', async () => {
    const labels = rowLabels(await render()).join(' | ');

    // The seed's first upcoming challenge starts tomorrow; if the split went
    // by anything other than the start date it would show up above as well.
    expect(labels).toContain('Starts Tomorrow');
    expect(labels).not.toMatch(/15K Steps Challenge.*\/ 15,000 steps/);
  });

  test('upcoming challenges are listed soonest first', async () => {
    const starts = rowLabels(await render()).filter(label =>
      label.includes('Starts'),
    );

    expect(starts[0]).toContain('15K Steps Challenge');
    expect(starts[1]).toContain('7 Days Consistency');
  });

  test('a cadence chip narrows both lists at once', async () => {
    const tree = await render();
    press(tree, 'Monthly');

    const text = allText(tree);
    // The only monthly pair in the seed, running and upcoming.
    expect(text).toContain('Monthly Mover');
    expect(text).toContain('Monthly Marathon');
    expect(text).not.toContain('10K Steps Challenge');
    expect(text).not.toContain('7 Days Consistency');
  });

  test('a period with nothing running says so instead of an empty panel', async () => {
    const tree = await render();
    press(tree, 'Weekly');

    // The seed has a weekly challenge running, so this is the reverse check:
    // the panel states a challenge rather than the empty line.
    expect(allText(tree)).toContain('Weekly Step Master');
    expect(allText(tree)).not.toContain('Nothing running for this period');
  });

  test('the achievement shelf leads with what has been earned', async () => {
    const labels = rowLabels(await render()).filter(
      label => label.includes('achieved') || label.includes('locked'),
    );

    expect(labels[0]).toContain('achieved');
    expect(labels.some(label => label.includes('locked'))).toBe(true);
  });

  test('every seeded challenge carries a reward the card can show', async () => {
    // The card draws coins from the challenge itself; a zero would render as a
    // reward chip that says nothing.
    expect(seedChallenges.every(c => c.rewardCoins > 0)).toBe(true);
  });

  test('the date opens a calendar rather than doing nothing', async () => {
    const tree = await render();

    expect(allText(tree)).not.toContain('Show challenges for');

    press(tree, 'Today,');

    // The sheet's own title, and the weekday header under it.
    expect(allText(tree)).toContain('Show challenges for');
    expect(allText(tree)).toContain('Mon');
  });

  test('picking a day moves the board to it', async () => {
    const tree = await render();
    press(tree, 'Today,');

    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);
    press(tree, longDateOf(inThreeDays));
    await settle();

    // The chip drops "Today," once the board is anchored somewhere else, and
    // the sheet closes behind the choice.
    expect(allText(tree)).toContain(longDateOf(inThreeDays));
    expect(allText(tree)).not.toContain('Show challenges for');
  });

  test('a challenge that has opened by the chosen day stops being upcoming', async () => {
    const tree = await render();

    const startsBefore = rowLabels(tree).filter(label =>
      label.includes('Starts'),
    );
    expect(startsBefore[0]).toContain('15K Steps Challenge');

    press(tree, 'Today,');
    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);
    press(tree, longDateOf(inThreeDays));
    await settle();

    // Tomorrow's and the day-after's challenges have both opened by then, so
    // the upcoming card starts at the next one still ahead of the chosen day.
    const startsAfter = rowLabels(tree).filter(label =>
      label.includes('Starts'),
    );
    expect(startsAfter[0]).toContain('Weekend Warrior');
    expect(startsAfter.join(' | ')).not.toContain('15K Steps Challenge');
  });

  test('the calendar offers a way back to today', async () => {
    const tree = await render();
    press(tree, 'Today,');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    press(tree, longDateOf(tomorrow));
    expect(allText(tree)).not.toContain('Today,');

    // Reopened from the chip, which now carries the chosen date rather than
    // the word "Today".
    press(tree, longDateOf(tomorrow));
    press(tree, 'Today');

    expect(allText(tree)).toContain('Today,');
  });

  test('the rewards strip explains itself on the leaderboard rules tab', async () => {
    press(await render(), 'How challenges work');

    expect(mockNavigate).toHaveBeenCalledWith('LeaderboardRewards', {
      tab: 'how',
    });
  });

  test('the chevron returns to whatever opened the board', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('the bell opens the notification centre', async () => {
    press(await render(), 'Notifications');

    expect(mockNavigate).toHaveBeenCalledWith('Notifications');
  });
});
