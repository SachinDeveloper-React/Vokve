/**
 * One day of the streak, opened from the calendar. The checks are that the
 * screen shows the day the server was asked about — its verdict, its figures
 * and its log — that the log is paged rather than fetched whole, that paging
 * to the day before asks the server for that day instead of pushing another
 * screen, and that the ends of the record are where the server says they are.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { clearServerReads } from '../src/hooks/useServerRead';
import { StreakDayScreen } from '../src/screens/main/StreakDayScreen';
import { ThemeProvider } from '../src/theme';
import { addDays, formatLongDate, todayIso } from '../src/utils/date';
import type { StreakDayDetail, StreakDayEvent } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockCanGoBack = true;
let mockRouteDate = '';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => mockCanGoBack,
  }),
  useRoute: () => ({ params: { date: mockRouteDate } }),
}));

jest.mock('../src/services/api/endpoints', () => ({
  streakApi: { day: jest.fn(), dayEvents: jest.fn() },
}));

const { streakApi } = jest.requireMock('../src/services/api/endpoints') as {
  streakApi: { day: jest.Mock; dayEvents: jest.Mock };
};

jest.mock('../src/stores/stepsStore', () => ({
  useLastStepSyncAt: () => null,
}));

const TODAY = todayIso();
const d = (daysAgo: number) => addDays(TODAY, -daysAgo);

const detail = (over: Partial<StreakDayDetail> = {}): StreakDayDetail => ({
  date: d(1),
  today: TODAY,
  status: 'completed',
  title: 'Day 2 of your current streak',
  detail: '10,428 steps',
  day: 2,
  run: { length: 3, start: d(2), end: TODAY },
  counted: true,
  steps: 10_428,
  stepGoal: 10_000,
  goalMet: true,
  verified: true,
  metrics: [
    { id: 'distance', label: 'Distance', value: '7.2 km', caption: null },
    { id: 'water', label: 'Water', value: '2,100 ml', caption: 'Goal 2,500 ml' },
  ],
  coinsEarned: 12,
  note: null,
  previousDate: d(2),
  nextDate: TODAY,
  ...over,
});

const event = (over: Partial<StreakDayEvent> = {}): StreakDayEvent => ({
  id: 'e-1',
  kind: 'coins',
  title: '10,428 steps walked',
  detail: 'Steps',
  at: `${d(1)}T12:30:00.000Z`,
  coins: 9.5,
  ...over,
});

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  // `useServerRead` keeps the last answer to each question so a screen can
  // paint before the network replies; between tests that would be the
  // previous test's day.
  clearServerReads();
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockCanGoBack = true;
  mockRouteDate = d(1);
  streakApi.day.mockReset().mockResolvedValue(detail());
  streakApi.dayEvents
    .mockReset()
    .mockResolvedValue({ data: [event()], nextCursor: null, total: 1 });
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
          <StreakDayScreen />
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

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    await node.props.onPress();
  });
};

describe('StreakDayScreen', () => {
  test('asks the server about the day it was opened on, and its first page of log', async () => {
    await render();

    expect(streakApi.day).toHaveBeenCalledTimes(1);
    expect(streakApi.day).toHaveBeenCalledWith(d(1));
    expect(streakApi.dayEvents).toHaveBeenCalledTimes(1);
    expect(streakApi.dayEvents).toHaveBeenCalledWith(d(1), undefined, 20);
  });

  test("shows the server's verdict, the day's figures and its log", async () => {
    const text = allText(await render());

    expect(text).toContain(formatLongDate(d(1)));
    expect(text).toContain('Day 2 of your current streak');
    expect(text).toContain('10,428 steps');
    expect(text).toContain('Completed');
    expect(text).toContain('10,428 / 10,000');
    expect(text).toContain('7.2 km');
    expect(text).toContain('Goal 2,500 ml');
    expect(text).toContain('12 coins earned');
    expect(text).toContain('Day Log');
    expect(text).toContain('10,428 steps walked');
  });

  test('a missed day shows what it would have taken, in the server’s words', async () => {
    streakApi.day.mockResolvedValue(
      detail({
        status: 'missed',
        title: 'Day missed',
        detail: '3,100 steps — short of your goal',
        day: null,
        run: null,
        counted: false,
        steps: 3_100,
        goalMet: false,
        coinsEarned: 0,
        note: 'A restore would bring this day back for 50 coins.',
      }),
    );
    const text = allText(await render());

    expect(text).toContain('Missed');
    expect(text).toContain('3,100 steps — short of your goal');
    expect(text).toContain('A restore would bring this day back for 50 coins.');
  });

  test('a second page of the log is appended, not swapped for the first', async () => {
    streakApi.dayEvents
      .mockReset()
      .mockResolvedValueOnce({
        data: [event({ id: 'e-1', title: 'first page' })],
        nextCursor: '1',
        total: 2,
      })
      .mockResolvedValueOnce({
        data: [event({ id: 'e-2', title: 'second page' })],
        nextCursor: null,
        total: 2,
      });
    const tree = await render();

    const list = tree.root.findAll(
      n => typeof n.props?.onEndReached === 'function',
    )[0];
    await ReactTestRenderer.act(async () => {
      list.props.onEndReached();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await settle();

    expect(streakApi.dayEvents).toHaveBeenLastCalledWith(d(1), '1', 20);
    const text = allText(tree);
    expect(text).toContain('first page');
    expect(text).toContain('second page');
  });

  test('paging to the day before asks the server for that day, in place', async () => {
    const tree = await render();

    await press(tree, 'Previous day');
    await settle();

    expect(streakApi.day).toHaveBeenLastCalledWith(d(2));
    expect(streakApi.dayEvents).toHaveBeenLastCalledWith(d(2), undefined, 20);
    // In place: no second copy of this screen on the stack.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('the ends of the record are where the server says they are', async () => {
    streakApi.day.mockResolvedValue(
      detail({ date: TODAY, previousDate: d(1), nextDate: null }),
    );
    mockRouteDate = TODAY;
    const tree = await render();

    const next = tree.root
      .findAll(n => n.props?.accessibilityLabel === 'Next day')
      .find(n => typeof n.props.onPress === 'function');
    expect(next?.props.accessibilityState).toEqual({ disabled: true });

    await press(tree, 'Next day');
    await settle();
    // Nothing past today to ask about.
    expect(streakApi.day).toHaveBeenCalledTimes(1);
  });

  test('a day with nothing on it says so rather than spinning', async () => {
    streakApi.dayEvents.mockResolvedValue({
      data: [],
      nextCursor: null,
      total: 0,
    });
    const text = allText(await render());

    expect(text).toContain('Nothing was logged on this day.');
    expect(text).not.toContain('Day Log');
  });

  test('a day that failed to load offers to try again', async () => {
    streakApi.day.mockRejectedValue(new Error('offline'));
    const text = allText(await render());

    expect(text).toContain("Couldn't load this day");
  });

  test('the chevron returns to whatever opened the day', async () => {
    const tree = await render();

    await press(tree, 'Back');
    expect(mockGoBack).toHaveBeenCalled();

    mockCanGoBack = false;
    await press(tree, 'Back');
    expect(mockNavigate).toHaveBeenCalledWith('Streak');
  });
});
