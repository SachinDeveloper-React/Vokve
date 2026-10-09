/**
 * The whole streak record, paged. The checks are that the list shows what the
 * server sent — missed days included, which is the point of it — that a
 * second page is asked for once and appended rather than replacing the first,
 * and that an empty record says so instead of spinning forever.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { StreakHistoryScreen } from '../src/screens/main/StreakHistoryScreen';
import { ThemeProvider } from '../src/theme';
import { addDays, todayIso } from '../src/utils/date';
import type { StreakHistoryDay } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockCanGoBack = true;

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => mockCanGoBack,
  }),
}));

jest.mock('../src/services/api/endpoints', () => ({
  streakApi: { history: jest.fn() },
}));

const { streakApi } = jest.requireMock('../src/services/api/endpoints') as {
  streakApi: { history: jest.Mock };
};

const TODAY = todayIso();
const d = (daysAgo: number) => addDays(TODAY, -daysAgo);

const day = (
  daysAgo: number,
  over: Partial<StreakHistoryDay> = {},
): StreakHistoryDay => ({
  date: d(daysAgo),
  day: 1,
  status: 'completed',
  detail: '9,120 steps',
  steps: 9_120,
  ...over,
});

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockCanGoBack = true;
  streakApi.history.mockReset();
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
          <StreakHistoryScreen />
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

const press = (tree: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  ReactTestRenderer.act(() => node.props.onPress());
};

describe('StreakHistoryScreen', () => {
  test('shows the record the server sent, missed days and all', async () => {
    streakApi.history.mockResolvedValue({
      data: [
        day(0, { day: 3, detail: '10,428 steps' }),
        day(1, { day: 2, status: 'frozen', detail: 'Freeze used', steps: 0 }),
        day(2, { day: null, status: 'missed', detail: 'No activity', steps: 0 }),
        day(3, { day: 1, status: 'restored', detail: 'Restored (50 coins)' }),
      ],
      nextCursor: null,
      total: 4,
    });
    const text = allText(await render());

    expect(text).toContain('4 days on the record');
    expect(text).toContain('10,428 steps');
    expect(text).toContain('Frozen');
    expect(text).toContain('Freeze used');
    expect(text).toContain('Missed');
    expect(text).toContain('Restored (50 coins)');
  });

  test('asks the server for one page to begin with', async () => {
    streakApi.history.mockResolvedValue({ data: [day(0)], nextCursor: null, total: 1 });
    await render();

    expect(streakApi.history).toHaveBeenCalledTimes(1);
    expect(streakApi.history).toHaveBeenCalledWith(undefined, 31);
  });

  test('a second page is appended to the first, not swapped for it', async () => {
    streakApi.history
      .mockResolvedValueOnce({
        data: [day(0, { detail: 'first page' })],
        nextCursor: d(0),
        total: 2,
      })
      .mockResolvedValueOnce({
        data: [day(1, { detail: 'second page' })],
        nextCursor: null,
        total: 2,
      });
    const tree = await render();

    const list = tree.root.findAll(n => typeof n.props?.onEndReached === 'function')[0];
    await ReactTestRenderer.act(async () => {
      list.props.onEndReached();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await settle();

    expect(streakApi.history).toHaveBeenLastCalledWith(d(0), 31);
    const text = allText(tree);
    expect(text).toContain('first page');
    expect(text).toContain('second page');
  });

  test('an empty record says so rather than spinning', async () => {
    streakApi.history.mockResolvedValue({ data: [], nextCursor: null, total: 0 });

    expect(allText(await render())).toContain('Nothing on the record yet');
  });

  test('a record that failed to load offers to try again', async () => {
    streakApi.history.mockRejectedValue(new Error('offline'));
    const tree = await render();

    expect(allText(tree)).toContain("Couldn't load your record");
  });

  test('the chevron returns to whatever opened the record', async () => {
    streakApi.history.mockResolvedValue({ data: [day(0)], nextCursor: null, total: 1 });
    const tree = await render();

    press(tree, 'Back');
    expect(mockGoBack).toHaveBeenCalled();

    mockCanGoBack = false;
    press(tree, 'Back');
    expect(mockNavigate).toHaveBeenCalledWith('Streak');
  });
});
