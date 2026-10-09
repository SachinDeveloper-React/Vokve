/**
 * The challenge detail screen is one server answer drawn three ways
 * (`GET /challenges/:id?date=`), so the checks here are about the screen
 * saying what that answer says and nothing more: the ring counting the window
 * the server chose rather than one the app derived, the rule sheet coming over
 * verbatim, the three tabs swapping what is under them without re-asking, and
 * the button at the foot going where the server said. Nothing is claimed
 * before the answer lands.
 *
 * @format
 */

import React from 'react';
import { Share, Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { ChallengeDetailScreen } from '../src/screens/main/ChallengeDetailScreen';
import { ThemeProvider } from '../src/theme';
import { challengeDetailSchema, type ChallengeDetail } from '../src/types/models';
import { clearServerReads } from '../src/hooks/useServerRead';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockCanGoBack = true;
let mockParams: { id: string; date?: string } = { id: 'ch-week-step-master' };

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => mockCanGoBack,
  }),
  useRoute: () => ({ params: mockParams }),
}));

// Spied rather than module-mocked: the platform's own `Share` is what the
// screen reaches for, and replacing the module takes React Native's re-export
// of it down with it.
const mockShare = jest
  .spyOn(Share, 'share')
  .mockResolvedValue({ action: 'sharedAction' } as never);

jest.mock('../src/services/api/endpoints', () => ({
  challengeApi: { detail: jest.fn() },
}));

const { challengeApi } = jest.requireMock('../src/services/api/endpoints') as {
  challengeApi: { detail: jest.Mock };
};

/**
 * A server answer, with the figures from the design: a weekly 70,000-step
 * challenge, three days in, 7,842 of today's 10,000 walked.
 */
const answer = (overrides: Partial<ChallengeDetail> = {}): ChallengeDetail =>
  challengeDetailSchema.parse({
    challenge: {
      id: 'ch-week-step-master',
      title: '10K Steps Every Day',
      description: 'Small steps. Big results.',
      emoji: '👟',
      metric: 'steps',
      cadence: 'weekly',
      goal: 70_000,
      progress: 23_526,
      rewardCoins: 500,
      rewardsBadge: true,
      startsAt: null,
      endsOn: '2026-09-21',
      completedAt: null,
    },
    period: {
      start: '2026-09-15',
      end: '2026-09-21',
      day: 3,
      days: 7,
      endsAt: new Date(Date.now() + 4 * 86_400_000).toISOString(),
    },
    focus: {
      scope: 'today',
      label: 'Daily Goal',
      value: 7_842,
      target: 10_000,
      remaining: 2_158,
      // Eight hours and change, so the clock has something to show.
      endsAt: new Date(Date.now() + 30_240_000).toISOString(),
      caption: "Today's Challenge Ends In",
    },
    reward: {
      coins: 500,
      caption: 'Finish the week to earn',
      badge: {
        id: 'a-step-master',
        value: 70_000,
        label: 'Step Master',
        metric: 'steps',
        achievedAt: null,
      },
    },
    rules: [
      { id: 'goal', icon: 'goal', text: 'Walk at least 10,000 steps each day', tone: 'default' },
      { id: 'duration', icon: 'duration', text: 'Challenge duration: 7 days (15 – 21 Sep 2026)', tone: 'default' },
      { id: 'integrity', icon: 'warning', text: 'Faked activity can cost you the reward', tone: 'caution' },
    ],
    joined: 12_431,
    finished: 2,
    ranked: 3,
    standings: [
      { id: 'u-1', name: 'Aman S.', avatarUrl: null, rank: 1, progress: 70_421, completed: true, isCurrentUser: false },
      { id: 'u-2', name: 'Neha K.', avatarUrl: null, rank: 2, progress: 68_320, completed: false, isCurrentUser: false },
      { id: 'u-3', name: 'Rohit M.', avatarUrl: null, rank: 3, progress: 65_908, completed: false, isCurrentUser: false },
      { id: 'u-4', name: 'Priya D.', avatarUrl: null, rank: 4, progress: 40_100, completed: false, isCurrentUser: false },
    ],
    me: { id: 'me', name: 'You', avatarUrl: null, rank: 9, progress: 23_526, completed: false, isCurrentUser: true },
    cta: { label: 'Continue Challenge', action: 'track_steps' },
    shareText: 'I am on day 3 of 7 of the 10K Steps Every Day challenge on VOKVE.',
    ...overrides,
  });

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockShare.mockClear();
  mockCanGoBack = true;
  mockParams = { id: 'ch-week-step-master' };
  clearServerReads();
  challengeApi.detail.mockReset();
  challengeApi.detail.mockResolvedValue(answer());
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

const render = async ({ wait = true } = {}) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ChallengeDetailScreen />
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

describe('ChallengeDetailScreen', () => {
  test('asks the server for the challenge and the day the board was showing', async () => {
    mockParams = { id: 'ch-10k-steps', date: '2026-09-17' };
    await render();

    expect(challengeApi.detail).toHaveBeenCalledWith('ch-10k-steps', '2026-09-17');
  });

  test('claims nothing before the answer lands, then says what it says', async () => {
    challengeApi.detail.mockReturnValueOnce(new Promise(() => {}));
    const tree = await render({ wait: false });
    expect(allText(tree)).not.toContain('10K Steps Every Day');

    challengeApi.detail.mockResolvedValue(answer());
    await ReactTestRenderer.act(async () => {
      tree.unmount();
    });
    mounted = null;

    const loaded = await render();
    const text = allText(loaded);
    expect(text).toContain('10K Steps Every Day');
    expect(text).toContain('Small steps. Big results.');
    expect(text).toContain('Weekly Challenge');
    expect(text).toContain('12.4k joined');
  });

  test('an answer that never came offers to try again', async () => {
    challengeApi.detail.mockRejectedValue(new Error('offline'));
    const tree = await render();

    expect(allText(tree)).toContain("Couldn't load this challenge");
    challengeApi.detail.mockResolvedValue(answer());
    press(tree, 'Try again');
    await settle();
    expect(allText(tree)).toContain('10K Steps Every Day');
  });

  test('the ring counts the window the server chose, not the whole challenge', async () => {
    const tree = await render();
    const text = allText(tree);

    // The day's share, written out beside the arc rather than only drawn.
    expect(text).toContain('7,842');
    expect(text).toContain('Daily Goal');
    expect(text).toContain('10,000 steps');
    expect(text).toContain('2,158');
    expect(text).toContain('steps left');
    expect(text).toContain('78%');
    // And where that day sits in the period it belongs to.
    expect(text).toContain('Day 3 of 7');
  });

  test('the clock counts down to the server’s deadline', async () => {
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain("Today's Challenge Ends In");
    expect(text).toMatch(/0[78]h \d\dm/);
  });

  test('a window that has already closed takes the clock off rather than freezing it', async () => {
    challengeApi.detail.mockResolvedValue(
      answer({
        focus: {
          ...answer().focus,
          endsAt: new Date(Date.now() - 60_000).toISOString(),
        },
      }),
    );
    const tree = await render();

    expect(allText(tree)).not.toContain("Today's Challenge Ends In");
    // The progress it did make is still there.
    expect(allText(tree)).toContain('7,842');
  });

  test('the reward is the server’s figure and its own caption', async () => {
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('Finish the week to earn');
    expect(text).toContain('500 coins');
    expect(text).toContain('Step Master');
  });

  test('the rules are the server’s words, verbatim', async () => {
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('Walk at least 10,000 steps each day');
    expect(text).toContain('Challenge duration: 7 days (15 – 21 Sep 2026)');
    expect(text).toContain('Faked activity can cost you the reward');
  });

  test('the tabs swap what is under them without asking the server again', async () => {
    const tree = await render();
    expect(challengeApi.detail).toHaveBeenCalledTimes(1);
    expect(allText(tree)).toContain('Challenge Rules');

    press(tree, 'Leaderboard');
    expect(allText(tree)).toContain('Challenge Leaderboard');
    expect(allText(tree)).not.toContain('Challenge Rules');

    press(tree, 'Participants');
    const text = allText(tree);
    expect(text).toContain('Joined');
    expect(text).toContain('Finished');
    expect(challengeApi.detail).toHaveBeenCalledTimes(1);
  });

  test('the top three are on the About tab, and View All opens the roster', async () => {
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('Aman S.');
    expect(text).toContain('70,421');
    expect(text).toContain('Rohit M.');
    // The fourth is behind the tab, not on the card.
    expect(text).not.toContain('Priya D.');

    press(tree, 'View all participants');
    expect(allText(tree)).toContain('Priya D.');
  });

  test('a place outside the listed ones is still shown to its owner', async () => {
    const tree = await render();
    press(tree, 'Leaderboard');

    expect(allText(tree)).toContain('You (you)');
  });

  test('the button goes where the server said', async () => {
    const tree = await render();
    press(tree, 'Continue Challenge');

    expect(mockNavigate).toHaveBeenCalledWith('StepTracking');
  });

  test('a finished challenge turns the button into the way back', async () => {
    challengeApi.detail.mockResolvedValue(
      answer({ cta: { label: 'Challenge Complete', action: 'view_board' } }),
    );
    const tree = await render();
    press(tree, 'Challenge Complete');

    expect(mockGoBack).toHaveBeenCalled();
  });

  test('a challenge that has not opened offers no button at all', async () => {
    challengeApi.detail.mockResolvedValue(
      answer({ cta: { label: 'Opens 22 Sep 2026', action: 'none' } }),
    );
    const tree = await render();

    expect(allText(tree)).toContain('Opens 22 Sep 2026');
    expect(() => press(tree, 'Opens 22 Sep 2026')).toThrow();
  });

  test('sharing sends the server’s wording', async () => {
    const tree = await render();
    press(tree, 'Share this challenge');

    expect(mockShare).toHaveBeenCalledWith({
      message: 'I am on day 3 of 7 of the 10K Steps Every Day challenge on VOKVE.',
    });
  });

  test('the chevron returns to whatever opened the challenge', async () => {
    const tree = await render();
    press(tree, 'Back');
    expect(mockGoBack).toHaveBeenCalled();

    mockCanGoBack = false;
    press(tree, 'Back');
    expect(mockNavigate).toHaveBeenCalledWith('Challenges');
  });
});
