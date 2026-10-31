/**
 * Home is where the rest of the app is reached from, so what is checked here
 * is the wiring: that the shortcut row and the bell lead to the screens they
 * name rather than to a tab that happens to contain something similar.
 *
 * @format
 */

import React from 'react';
import { ToastProvider } from '../src/components/feedback';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text as RNText } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { mockSnapshot } from 'react-native-step-tracker-pro/jest';
import { HomeScreen } from '../src/screens/main/HomeScreen';
import { useHydrationStore } from '../src/stores/hydrationStore';
import { useStepsStore } from '../src/stores/stepsStore';
import { useStreakStore } from '../src/stores/streakStore';
import { ThemeProvider } from '../src/theme';
import { textOf } from './helpers/text';
import { waterDay } from './helpers/hydration';
import { addDays, todayIso } from '../src/utils/date';

const mockNavigate = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// The day's motivation line is the server's; these tests are about the
// wiring, so it is left on its way rather than fetched for real.
jest.mock('../src/services/api/endpoints', () => ({
  ...jest.requireActual('../src/services/api/endpoints'),
  contentApi: {
    tip: jest.fn(() => new Promise(() => {})),
    referralCards: jest.fn(() => new Promise(() => {})),
  },
}));

const { contentApi } = jest.requireMock('../src/services/api/endpoints') as {
  contentApi: { tip: jest.Mock; referralCards: jest.Mock };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

const INITIAL_STEPS = useStepsStore.getState();

beforeEach(() => {
  mockNavigate.mockClear();
  useStepsStore.setState(INITIAL_STEPS, true);
  useStreakStore.getState().reset();
});

const labelsOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll(n => typeof n.props?.accessibilityLabel === 'string')
    .map(n => n.props.accessibilityLabel as string);

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
          <ToastProvider>
            <HomeScreen />
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

const pressableFor = (
  tree: ReactTestRenderer.ReactTestRenderer,
  prefix: string,
) => {
  const node = tree.root
    .findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        (n.props.accessibilityLabel as string).startsWith(prefix),
    )
    .find(n => typeof n.props.onPress === 'function');

  if (!node) throw new Error(`No pressable labelled "${prefix}…"`);
  return node;
};

const press = (tree: ReactTestRenderer.ReactTestRenderer, prefix: string) => {
  const node = pressableFor(tree, prefix);
  ReactTestRenderer.act(() => node.props.onPress());
};

/**
 * The chevron's own box inside a shortcut tile. Host nodes only: `<View>` is
 * a composite over a host `View`, so an unfiltered search counts it twice.
 */
const chevronMarkOf = (
  tree: ReactTestRenderer.ReactTestRenderer,
  prefix: string,
) =>
  pressableFor(tree, prefix).findAll(
    n => typeof n.type === 'string' && n.props?.pointerEvents === 'none',
  );

const flatten = (style: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const visit = (s: unknown) => {
    if (Array.isArray(s)) return s.forEach(visit);
    if (s && typeof s === 'object') Object.assign(out, s);
  };
  visit(style);
  return out;
};

/** The four tiles of the shortcut row, by the prefix each is labelled with. */
const SHORTCUTS = [
  'Challenges &',
  'Nutrition &',
  'Health check up',
  'Streaks',
] as const;

describe('HomeScreen', () => {
  test('the challenges shortcut opens the board as a route of its own', async () => {
    press(await render(), 'Challenges &');

    expect(mockNavigate).toHaveBeenCalledWith('Challenges');
  });

  test('the hydration card opens the hydration screen', async () => {
    press(await render(), 'Hydration,');

    expect(mockNavigate).toHaveBeenCalledWith('Hydration');
  });

  test("the step card's Edit Goal opens the step goal screen", async () => {
    press(await render(), 'Edit daily step goal');

    expect(mockNavigate).toHaveBeenCalledWith('StepGoal');
  });

  test('the analysis tile opens the steps analytics', async () => {
    press(await render(), 'Analysis');

    expect(mockNavigate).toHaveBeenCalledWith('Analytics');
  });

  test('the health shortcut opens the checkup', async () => {
    press(await render(), 'Health check up');

    expect(mockNavigate).toHaveBeenCalledWith('HealthCheckup');
  });

  test('the nutrition shortcut opens the nutrition screen', async () => {
    press(await render(), 'Nutrition &');

    expect(mockNavigate).toHaveBeenCalledWith('Nutrition');
  });

  test('the bell opens the notification centre', async () => {
    press(await render(), 'Notifications');

    expect(mockNavigate).toHaveBeenCalledWith('Notifications');
  });

  test('the streak shortcut opens the streak as a route of its own', async () => {
    press(await render(), 'Streaks');

    expect(mockNavigate).toHaveBeenCalledWith('Streak');
  });

  test('the invite card is the one the server put on this screen, and it opens Referral', async () => {
    // Every word is the server's: the screen names the placement and draws
    // whatever comes back for it, so a campaign is a panel edit.
    contentApi.referralCards.mockResolvedValueOnce({
      cards: {
        home: {
          id: 'home-invite-diwali',
          screen: 'home',
          title: 'Double up this Diwali',
          message: 'Bring a friend and take 40 coins each.',
          ctaLabel: 'Share now',
          accent: 'gold',
          position: 'middle',
          emoji: '\u{1FA94}',
          inviterCoins: 40,
          inviteeCoins: 40,
        },
      },
    });

    const tree = await render();
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    expect(textOf(tree, RNText)).toContain('Double up this Diwali');
    expect(textOf(tree, RNText)).toContain('Share now');
    // Once only: the screen offers three anchors and the card names one, so
    // three banners would mean the position was being ignored.
    expect(textOf(tree, RNText).split('Double up this Diwali')).toHaveLength(2);

    press(tree, 'Double up this Diwali');
    expect(mockNavigate).toHaveBeenCalledWith('Referral');
  });

  test('a screen the operator has written no card for draws none', async () => {
    contentApi.referralCards.mockResolvedValueOnce({ cards: {} });

    const tree = await render();
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    expect(mockNavigate).not.toHaveBeenCalledWith('Referral');
    expect(textOf(tree, RNText)).not.toContain('Invite');
  });

  test('every shortcut tile wears a chevron, so the row reads as four doors', async () => {
    const tree = await render();

    for (const label of SHORTCUTS) {
      const tile = pressableFor(tree, label);
      // One, not two: a tile that collected a second would be a tile whose
      // own content had started drawing arrows of its own.
      expect(tile.findAllByType(ChevronRight)).toHaveLength(1);
    }
  });

  test('the chevron is decoration — the whole tile stays one tap target', async () => {
    const mark = chevronMarkOf(await render(), 'Challenges &');

    expect(mark).toHaveLength(1);
    expect(mark[0].findAllByType(ChevronRight)).toHaveLength(1);
  });

  test('the chevron sits in the top right, clear of the labels', async () => {
    const style = flatten(chevronMarkOf(await render(), 'Streaks')[0].props.style);

    expect(style.position).toBe('absolute');
    // Hung from the top and the right, so it stays out of the two label
    // lines however they wrap. Not stretched: a box pinned top *and* bottom
    // would centre the glyph back down onto the text.
    expect(typeof style.top).toBe('number');
    expect(typeof style.right).toBe('number');
    expect(style.bottom).toBeUndefined();
    expect(style.left).toBeUndefined();
  });

  test('the dashboard cannot log past the day’s ceiling either', async () => {
    // The gap this closes: the water screen checked the limits and this card
    // called the store directly, so a user could tap a litre over and over
    // from the dashboard and never be asked (RULES Y1b).
    await ReactTestRenderer.act(async () => {
      useHydrationStore.setState({
        day: waterDay(
          [
            {
              id: 'huge',
              ml: 9900,
              at: new Date(Date.now() - 6 * 3_600_000).toISOString(),
            },
          ],
          todayIso(),
        ),
        syncedAt: new Date().toISOString(),
      });
    });
    const tree = await render();

    press(tree, 'Add 200 millilitres');

    expect(textOf(tree, RNText)).toContain('the most Vokve records in a day');
    expect(useHydrationStore.getState().outbox).toHaveLength(0);
  });

  test('and asks about a fast one, from the dashboard as from the water screen', async () => {
    await ReactTestRenderer.act(async () => {
      useHydrationStore.setState({
        // 1.2 L already, all of it in the last few minutes.
        day: waterDay(
          [
            {
              id: 'fast',
              ml: 1200,
              at: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
          todayIso(),
        ),
        syncedAt: new Date().toISOString(),
      });
    });
    const tree = await render();

    press(tree, 'Add 500 millilitres');

    expect(textOf(tree, RNText)).toContain('That is fast');
    // Nothing logged behind the question.
    expect(useHydrationStore.getState().outbox).toHaveLength(0);
  });

  test("the streak shortcut carries the server's run, and a dash before it has said", async () => {
    expect(labelsOf(await render())).toContain('Streaks —');

    useStreakStore.setState({
      summary: {
        today: todayIso(),
        currentStreak: 12,
        longestStreak: {
          length: 12,
          start: addDays(todayIso(), -11),
          end: todayIso(),
        },
        completedDays: [],
        protectedDays: [],
        freezesAvailable: 1,
        maxFreezes: 3,
        todayCovered: true,
        todayFrozen: false,
        canRestore: false,
        restoreGap: [],
        restoreCostCoins: 50,
        restoreWindowDays: 7,
        milestones: [],
        nextMilestone: null,
        howToEarn: 'Walk 10,000 steps in a day.',
      },
      syncedAt: new Date().toISOString(),
    });
    expect(labelsOf(await render())).toContain('Streaks 12 Days');
  });

  test('a phone not counting yet is asked to, and the prompt opens step tracking', async () => {
    useStepsStore.setState({ supported: true, trackingState: 'idle' });

    press(await render(), 'Start counting your steps');

    expect(mockNavigate).toHaveBeenCalledWith('StepTracking');
  });

  test('the step cards show the verified part of the server’s day, not the phone’s own count', async () => {
    useStepsStore.setState({
      supported: true,
      trackingState: 'running',
      // The phone has counted further than the server has heard about yet.
      today: mockSnapshot({ state: 'running', steps: 9999 }),
      serverWeek: [
        {
          date: addDays(todayIso(), -1),
          steps: 8765,
          verifiedSteps: 8765,
          distanceKm: 6,
          activeMinutes: 60,
          caloriesBurned: 300,
          workoutsCompleted: 0,
          source: 'device',
          verified: true,
        },
        {
          date: todayIso(),
          steps: 4321,
          verifiedSteps: 4000,
          distanceKm: 3.1,
          activeMinutes: 37,
          caloriesBurned: 180,
          workoutsCompleted: 0,
          source: 'device',
          verified: true,
        },
      ],
    });

    const text = textOf(await render(), RNText);

    // 4,000 of today's 4,321 passed the server's checks, so 4,000 is the
    // figure, and the distance, the minutes and the calories are cut to the
    // same share — 4,321 steps' walking is not what was verified.
    expect(text).toContain('4,000');
    expect(text).not.toContain('4,321');
    expect(text).not.toContain('9,999');
    expect(text).toContain('2.9 km');
    expect(text).toContain('34 min');
    expect(text).toContain('167 kcal');
    // Yesterday was verified end to end, so the chart shows all of it.
    expect(text).toContain('8,765');
    expect(text).not.toContain('Start counting your steps');
  });

  test('a day the server verified none of shows no steps, not the count it refused', async () => {
    useStepsStore.setState({
      supported: true,
      trackingState: 'running',
      today: mockSnapshot({ state: 'running', steps: 11_199 }),
      serverWeek: [
        {
          date: todayIso(),
          steps: 11_199,
          verifiedSteps: 0,
          distanceKm: 8.4,
          activeMinutes: 96,
          caloriesBurned: 420,
          workoutsCompleted: 0,
          source: 'device',
          verified: false,
        },
      ],
    });

    const text = textOf(await render(), RNText);

    // Not even a few steps at a time: the live tail is cut by the share the
    // server verified, which on a held day is none of it.
    expect(text).not.toContain('11,199');
    expect(text).not.toContain('8.4 km');
    expect(text).toContain('0 / 10,000');
  });

  test('the figure climbs with the walk, from the server\u2019s number up', async () => {
    const today = todayIso();
    useStepsStore.setState({
      supported: true,
      trackingState: 'running',
      // The server took 3,000 from this phone and verified all of it; the
      // phone has counted 20 more since.
      synced: { [today]: { steps: 3000, recoveredSteps: 0, suspectSteps: 0, at: Date.now() } },
      today: mockSnapshot({ state: 'running', steps: 3020 }),
      serverWeek: [
        {
          date: today,
          steps: 3000,
          verifiedSteps: 3000,
          distanceKm: 2.1,
          activeMinutes: 25,
          caloriesBurned: 120,
          workoutsCompleted: 0,
          source: 'device',
          verified: true,
        },
      ],
    });

    expect(textOf(await render(), RNText)).toContain('3,020');
  });

  test('a phone without step counting gets no prompt to turn it on', async () => {
    useStepsStore.setState({ supported: false });

    expect(textOf(await render(), RNText)).not.toContain(
      'Start counting your steps',
    );
  });
});
