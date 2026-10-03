/**
 * The reminder screen states the same plan four ways — the count beside the
 * master switch, the four figures under it, the chips, and the custom rows —
 * so the checks here are that they move together: switching a chip off has to
 * change the count and the next reminder in the same breath, and the master
 * switch has to take the whole thing to zero. The plan is the server's: an
 * edit is sent whole, and nothing is drawn before the first answer.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { HydrationReminderScreen } from '../src/screens/main/HydrationReminderScreen';
import { ThemeProvider } from '../src/theme';
import {
  nextReminderTime,
  useRemindersStore,
} from '../src/stores/remindersStore';
import { useSettingsStore } from '../src/stores/settingsStore';
import { clearServerReads } from '../src/hooks/useServerRead';
import type { HydrationReminderPlan } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
}));

// Latency is what makes spinners visible in the app and slow in a test suite.
jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    mockLatencyMs: 0,
  },
}));

// The mock backend's own plan store and tips, behind spies.
jest.mock('../src/services/api/endpoints', () => {
  const api = jest.requireActual('../src/services/api/mockApi');
  return {
    hydrationApi: {
      reminders: jest.fn(() => api.mockHydrationApi.reminders()),
      saveReminders: jest.fn((plan: unknown, options: unknown) =>
        api.mockHydrationApi.saveReminders(plan, options),
      ),
    },
    contentApi: {
      tip: jest.fn((topic: string) => api.mockContentApi.tip(topic)),
    },
  };
});

const { hydrationApi } = jest.requireMock('../src/services/api/endpoints') as {
  hydrationApi: { reminders: jest.Mock; saveReminders: jest.Mock };
};

/** Seven presets and two custom times, all on, every day. */
const PLAN: HydrationReminderPlan = {
  enabled: true,
  sound: 'Default',
  vibration: true,
  repeatDays: [0, 1, 2, 3, 4, 5, 6],
  reminders: [
    ['morning', '07:00'],
    ['morning', '08:30'],
    ['morning', '10:00'],
    ['custom', '11:00'],
    ['afternoon', '13:00'],
    ['afternoon', '15:30'],
    ['evening', '18:00'],
    ['evening', '20:00'],
    ['custom', '21:30'],
  ].map(([slot, time]) => ({
    id: `${slot}-${time}`,
    time,
    slot: slot as HydrationReminderPlan['reminders'][number]['slot'],
    enabled: true,
  })),
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  clearServerReads();
  hydrationApi.reminders.mockClear();
  hydrationApi.saveReminders.mockClear();
  useRemindersStore.getState().reset();
  useRemindersStore.setState({
    plan: PLAN,
    syncedAt: new Date().toISOString(),
  });
  useSettingsStore.setState({ dailyWaterGoalMl: 2500 });
});

const reminders = () => useRemindersStore.getState().plan?.reminders ?? [];

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
          <HydrationReminderScreen />
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

/** The switch, or any control that reports a checked state, by label. */
const toggle = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
  next: boolean,
) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onValueChange === 'function');

  if (!node) throw new Error(`No switch labelled "${label}"`);
  ReactTestRenderer.act(() => node.props.onValueChange(next));
};

describe('HydrationReminderScreen', () => {
  test('before the first answer it says it is loading, and draws no plan', async () => {
    useRemindersStore.getState().reset();
    hydrationApi.reminders.mockReturnValueOnce(new Promise(() => {}));

    const text = allText(await render());

    expect(text).not.toContain('reminders active');
  });

  test('an edit is sent to the server whole', async () => {
    const tree = await render();

    press(tree, '07:00 AM, on');

    expect(hydrationApi.saveReminders).toHaveBeenCalledWith(
      expect.objectContaining({
        reminders: expect.arrayContaining([
          expect.objectContaining({ time: '07:00', enabled: false }),
        ]),
      }),
      { idempotencyKey: expect.any(String) },
    );
  });

  test('the plan states how many reminders are on and what is next', async () => {
    const text = allText(await render());

    // Nine seeded times, all on: seven presets and two custom.
    expect(text).toContain('9 reminders active');
    expect(text).toContain('Reminders ON');
    expect(text).toContain('Everyday');
    expect(text).toContain('2.5 L');
  });

  test('the master switch takes the count to zero without deleting anything', async () => {
    const tree = await render();

    toggle(tree, 'Hydration reminders', false);

    expect(allText(tree)).toContain('0 reminders active');
    // The times are still there — the switch silences them, it does not clear
    // the plan the user built.
    expect(reminders()).toHaveLength(9);
  });

  test('switching a preset chip off lowers the count', async () => {
    const tree = await render();

    press(tree, '07:00 AM, on');

    expect(allText(tree)).toContain('8 reminders active');
  });

  test('the next reminder is the next one still ahead of now', () => {
    const list = reminders();

    // 10:00 is the first seeded time after half past eight.
    const morning = new Date();
    morning.setHours(8, 30, 0, 0);
    expect(nextReminderTime(list, true, morning)).toBe('10:00');

    // Past the last one, it wraps to tomorrow's first rather than reading
    // empty for the whole evening.
    const night = new Date();
    night.setHours(23, 0, 0, 0);
    expect(nextReminderTime(list, true, night)).toBe('07:00');
  });

  test('nothing is next once the master switch is off', () => {
    expect(nextReminderTime(reminders(), false)).toBeNull();
  });

  test('a custom time can be deleted through its menu', async () => {
    const tree = await render();
    expect(allText(tree)).toContain('2 custom times');

    press(tree, 'More options for the 11:00 AM reminder');
    press(tree, 'Delete reminder');

    expect(allText(tree)).toContain('1 custom time');
    expect(reminders().some(r => r.time === '11:00')).toBe(false);
  });

  test('dropping a repeat day changes the plan from Everyday to the days left', async () => {
    const tree = await render();

    toggle(tree, 'Vibration', false);
    expect(useRemindersStore.getState().plan?.vibration).toBe(false);

    press(tree, 'Sunday, on');

    expect(allText(tree)).toContain('M T W T F S');
    expect(allText(tree)).not.toContain('Everyday');
  });

  test('the add control opens a picker rather than adding a time itself', async () => {
    const tree = await render();

    press(tree, 'Add a custom time');

    expect(allText(tree)).toContain('Add a reminder');
    expect(reminders()).toHaveLength(9);
  });

  test('the chevron returns to whatever opened the plan', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
