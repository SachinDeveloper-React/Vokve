/**
 * The achievement detail screen is one server answer, wording included: the
 * description, the "about" paragraph and the line under the status chip are
 * all derived server-side from the rule it enforces. So the checks here are
 * about the screen repeating that faithfully — the best-on-record figure
 * against the threshold, the bar capped at done, a locked badge saying what is
 * left rather than claiming a date, and the ladder letting the reader walk up
 * and down it without stacking screens.
 *
 * @format
 */

import React from 'react';
import { Share, Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { AchievementDetailScreen } from '../src/screens/main/AchievementDetailScreen';
import { ThemeProvider } from '../src/theme';
import {
  achievementDetailSchema,
  type AchievementDetail,
} from '../src/types/models';
import { clearServerReads } from '../src/hooks/useServerRead';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockCanGoBack = true;
let mockParams: { id: string } = { id: 'a-10k-steps' };

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => mockCanGoBack,
  }),
  useRoute: () => ({ params: mockParams }),
}));

const mockShare = jest
  .spyOn(Share, 'share')
  .mockResolvedValue({ action: 'sharedAction' } as never);

jest.mock('../src/services/api/endpoints', () => ({
  challengeApi: { achievement: jest.fn() },
}));

const { challengeApi } = jest.requireMock('../src/services/api/endpoints') as {
  challengeApi: { achievement: jest.Mock };
};

/** The figures from the design: 10,428 walked against a 10,000-step badge. */
const answer = (overrides: Partial<AchievementDetail> = {}): AchievementDetail =>
  achievementDetailSchema.parse({
    achievement: {
      id: 'a-10k-steps',
      value: 10_000,
      label: '10K Steps',
      metric: 'steps',
      achievedAt: '2026-09-18T19:32:00.000Z',
    },
    title: '10K Steps Champion',
    description: 'Walk 10,000 steps in a single day.',
    about:
      'This achievement is awarded when you walk 10,000 steps in a single day. It shows your dedication towards an active lifestyle.',
    note: 'You did it! Consistency leads to a healthier you.',
    unlocked: true,
    unlockedAt: '2026-09-18T19:32:00.000Z',
    progress: {
      basis: 'best_day',
      label: 'Your best day',
      value: 10_428,
      target: 10_000,
      percent: 100,
      caption: 'Goal completed on 18 Sep 2026',
      completedOn: '2026-09-18',
    },
    reward: {
      coins: 50,
      via: 'achievement',
      caption: 'Coins for badges start soon',
      paid: false,
    },
    cheer: {
      title: 'Great job!',
      message: "You're one step closer to a fitter, healthier you.",
    },
    related: [
      { id: 'a-5k-steps', value: 5_000, label: '5K Steps', metric: 'steps', achievedAt: '2026-09-01T10:00:00.000Z' },
      { id: 'a-10k-steps', value: 10_000, label: '10K Steps', metric: 'steps', achievedAt: '2026-09-18T19:32:00.000Z' },
      { id: 'a-20k-steps', value: 20_000, label: '20K Steps', metric: 'steps', achievedAt: null },
      { id: 'a-30k-steps', value: 30_000, label: '30K Steps', metric: 'steps', achievedAt: null },
    ],
    cta: { label: 'Keep Going', action: 'track_steps' },
    shareText: 'I just unlocked the 10K Steps Champion badge on VOKVE.',
    ...overrides,
  });

const locked = () =>
  answer({
    achievement: {
      id: 'a-20k-steps',
      value: 20_000,
      label: '20K Steps',
      metric: 'steps',
      achievedAt: null,
    },
    title: '20K Steps Champion',
    description: 'Walk 20,000 steps in a single day.',
    note: '9,572 steps to go — keep moving and it is yours.',
    unlocked: false,
    unlockedAt: null,
    progress: {
      basis: 'best_day',
      label: 'Your best day',
      value: 10_428,
      target: 20_000,
      percent: 52,
      caption: '9,572 steps to go',
      completedOn: null,
    },
    cheer: {
      title: 'Keep going',
      message: 'Every day you move brings this one closer.',
    },
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
  mockParams = { id: 'a-10k-steps' };
  clearServerReads();
  challengeApi.achievement.mockReset();
  challengeApi.achievement.mockResolvedValue(answer());
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
          <AchievementDetailScreen />
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

describe('AchievementDetailScreen', () => {
  test('asks the server for the badge the route named', async () => {
    mockParams = { id: 'a-cal-burner' };
    await render();

    expect(challengeApi.achievement).toHaveBeenCalledWith('a-cal-burner');
  });

  test('claims nothing before the answer lands', async () => {
    challengeApi.achievement.mockReturnValueOnce(new Promise(() => {}));
    const tree = await render({ wait: false });

    expect(allText(tree)).not.toContain('10K Steps Champion');
    // The masthead is still there to go back from.
    expect(allText(tree)).toContain('Achievement Details');
  });

  test('an answer that never came offers to try again', async () => {
    challengeApi.achievement.mockRejectedValue(new Error('offline'));
    const tree = await render();

    expect(allText(tree)).toContain("Couldn't load this achievement");
    challengeApi.achievement.mockResolvedValue(answer());
    press(tree, 'Try again');
    await settle();
    expect(allText(tree)).toContain('10K Steps Champion');
  });

  test('repeats the server’s wording rather than writing its own', async () => {
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('10K Steps Champion');
    expect(text).toContain('Walk 10,000 steps in a single day.');
    expect(text).toContain(
      'This achievement is awarded when you walk 10,000 steps in a single day. It shows your dedication towards an active lifestyle.',
    );
    expect(text).toContain('You did it! Consistency leads to a healthier you.');
  });

  test('states the best on record against the threshold, capped at done', async () => {
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('10,428');
    expect(text).toContain('/ 10,000');
    // 10,428 of 10,000 is done, not 104% done.
    expect(text).toContain('100%');
    expect(text).toContain('Goal completed on 18 Sep 2026');
    expect(text).toContain('Unlocked');
  });

  test('shows the reward and says plainly that badge coins have not started', async () => {
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('50 coins');
    expect(text).toContain('Coins for badges start soon');
  });

  test('dates the unlock from the server’s own timestamp', async () => {
    const tree = await render();
    expect(allText(tree)).toContain('18 September 2026');
  });

  test('a locked badge says what is left instead of claiming a date', async () => {
    challengeApi.achievement.mockResolvedValue(locked());
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('Locked');
    expect(text).toContain('9,572 steps to go');
    expect(text).toContain('52%');
    expect(text).toContain('Not yet unlocked');
    expect(text).not.toContain('Goal completed on');
    expect(text).toContain('Keep going');
  });

  test('the ladder shows where this badge sits, with each rung’s state', async () => {
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('Related Achievements');
    expect(text).toContain('5K Steps');
    expect(text).toContain('20K Steps');
    expect(text).toContain('30K Steps');
  });

  test('a rung swaps the subject instead of stacking another screen', async () => {
    const tree = await render();
    challengeApi.achievement.mockResolvedValue(locked());

    press(tree, '20K Steps, locked');
    await settle();

    expect(challengeApi.achievement).toHaveBeenLastCalledWith('a-20k-steps');
    expect(allText(tree)).toContain('20K Steps Champion');
    // Nothing was pushed — the reader can still leave in one tap.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('"View All" opens the shelf', async () => {
    const tree = await render();
    press(tree, 'View all achievements');

    expect(mockNavigate).toHaveBeenCalledWith('Achievements');
  });

  test('the button goes where the server said', async () => {
    const tree = await render();
    press(tree, 'Keep Going');

    expect(mockNavigate).toHaveBeenCalledWith('StepTracking');
  });

  test('a badge with no rung above it sends the reader back to the shelf', async () => {
    challengeApi.achievement.mockResolvedValue(
      answer({ cta: { label: 'View All Achievements', action: 'view_shelf' } }),
    );
    const tree = await render();
    press(tree, 'View All Achievements');

    expect(mockNavigate).toHaveBeenCalledWith('Achievements');
  });

  test('sharing sends the server’s wording', async () => {
    const tree = await render();
    press(tree, 'Share this achievement');

    expect(mockShare).toHaveBeenCalledWith({
      message: 'I just unlocked the 10K Steps Champion badge on VOKVE.',
    });
  });

  test('the chevron returns to whatever opened the badge', async () => {
    const tree = await render();
    press(tree, 'Back');
    expect(mockGoBack).toHaveBeenCalled();

    mockCanGoBack = false;
    press(tree, 'Back');
    expect(mockNavigate).toHaveBeenCalledWith('Achievements');
  });
});
