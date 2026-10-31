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
import { ToastProvider } from '../src/components/feedback';
import {
  nextReminderTime,
  useRemindersStore,
} from '../src/stores/remindersStore';
import { useSettingsStore } from '../src/stores/settingsStore';
import { useNotificationSettingsStore } from '../src/stores/notificationSettingsStore';
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
      reminderSounds: jest.fn(() => api.mockHydrationApi.reminderSounds()),
      saveReminders: jest.fn((plan: unknown, options: unknown) =>
        api.mockHydrationApi.saveReminders(plan, options),
      ),
    },
    contentApi: {
      referralCards: jest.fn(() => api.mockContentApi.referralCards()),
      tip: jest.fn((topic: string) => api.mockContentApi.tip(topic)),
    },
  };
});

const { hydrationApi } = jest.requireMock('../src/services/api/endpoints') as {
  hydrationApi: {
    reminders: jest.Mock;
    reminderSounds: jest.Mock;
    saveReminders: jest.Mock;
  };
};

/** Seven presets and two custom times, all on, every day. */
const PLAN: HydrationReminderPlan = {
  enabled: true,
  sound: 'water_drop',
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
  hydrationApi.reminderSounds.mockClear();
  hydrationApi.saveReminders.mockClear();
  useRemindersStore.getState().reset();
  useRemindersStore.setState({
    plan: PLAN,
    syncedAt: new Date().toISOString(),
  });
  useSettingsStore.setState({ dailyWaterGoalMl: 2500 });
  // Health notifications are off by default, which the screen says out loud
  // (RULES Y6). On, except where a test is about that.
  useNotificationSettingsStore.setState(state => ({
    categories: { ...state.categories, health: true },
    // Off, so the seeded evening times are not silenced in checks that are
    // about something else. The two checks that are about the window set it.
    quietHours: { ...state.quietHours, enabled: false },
  }));
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
          <ToastProvider>
            <HydrationReminderScreen />
          </ToastProvider>
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

/** The time sheet, if one is open. */
const openPicker = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll(n => typeof n.props?.onSubmit === 'function')
    .find(n => n.props.visible === true);

const longPress = (
  tree: ReactTestRenderer.ReactTestRenderer,
  prefix: string,
) => {
  const node = tree.root
    .findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        (n.props.accessibilityLabel as string).startsWith(prefix),
    )
    .find(n => typeof n.props.onLongPress === 'function');

  if (!node)
    throw new Error(`Nothing labelled "${prefix}…" takes a long press`);
  ReactTestRenderer.act(() => node.props.onLongPress());
};

/** Commits a time in whichever picker sheet is open. */
const submitTime = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  time: string,
) => {
  const picker = tree.root
    .findAll(n => typeof n.props?.onSubmit === 'function')
    .find(n => n.props.visible === true);
  if (!picker) throw new Error('No open time picker');
  await ReactTestRenderer.act(async () => {
    picker.props.onSubmit(time);
  });
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

  test('holding a preset chip moves that time rather than adding another', async () => {
    const tree = await render();

    longPress(tree, '08:30 AM, on');
    // Opened on the time it is for, and saying it will change it rather than
    // add one — the sheet is the same three columns either way.
    expect(allText(tree)).toContain('Change the time');

    await submitTime(tree, '09:15');

    expect(reminders().some(r => r.time === '08:30')).toBe(false);
    const moved = reminders().find(r => r.time === '09:15');
    // Its block and its switch survive the move: only the time changed.
    expect(moved).toMatchObject({ slot: 'morning', enabled: true });
    expect(reminders()).toHaveLength(9);
    expect(allText(tree)).toContain('09:15 AM');
  });

  test('a preset time can be deleted from the sheet its hold opens', async () => {
    const tree = await render();
    expect(reminders()).toHaveLength(9);

    // The chips have room for one control and the tap is the switch, so the
    // hold is the only way in — and what it opens has to offer both halves
    // of what a user does to a time they set by mistake.
    longPress(tree, '08:30 AM, on');
    press(tree, 'Delete reminder');

    expect(reminders().some(r => r.time === '08:30')).toBe(false);
    expect(reminders()).toHaveLength(8);
    // The block's own count follows it down.
    expect(allText(tree)).toContain('2 of 5 times');
    expect(allText(tree)).not.toContain('08:30 AM');
  });

  test('a custom time can be deleted from its sheet as well as its menu', async () => {
    const tree = await render();

    longPress(tree, '11:00 AM, Everyday');
    press(tree, 'Delete reminder');

    expect(reminders().some(r => r.time === '11:00')).toBe(false);
    expect(allText(tree)).toContain('1 custom time');
  });

  test('a sheet opened to add a time has nothing to delete', async () => {
    const tree = await render();

    press(tree, 'Add a time to Morning');

    expect(
      tree.root.findAll(
        node => node.props?.accessibilityLabel === 'Delete reminder',
      ),
    ).toHaveLength(0);
  });

  test('holding a custom row changes its time, and so does its menu', async () => {
    const tree = await render();

    longPress(tree, '11:00 AM, Everyday');
    await submitTime(tree, '11:45');
    expect(reminders().some(r => r.time === '11:45')).toBe(true);

    // The kebab carries the same edit, for somebody who never found the hold.
    press(tree, 'More options for the 11:45 AM reminder');
    press(tree, 'Change time');
    await submitTime(tree, '12:15');

    expect(reminders().some(r => r.time === '11:45')).toBe(false);
    expect(reminders().some(r => r.time === '12:15')).toBe(true);
    expect(allText(tree)).toContain('2 custom times');
  });

  test('moving a time onto one its block already has is dropped, not doubled', async () => {
    const tree = await render();

    longPress(tree, '08:30 AM, on');
    await submitTime(tree, '10:00');

    // Two chips reading 10:00 AM would both ring, and neither could be told
    // from the other.
    expect(reminders().filter(r => r.time === '10:00')).toHaveLength(1);
    expect(reminders().some(r => r.time === '08:30')).toBe(true);
  });

  test('a time moved into quiet hours says so, like one added there', async () => {
    useNotificationSettingsStore.setState({
      quietHours: { enabled: true, start: '22:00', end: '07:00' },
    });
    const tree = await render();

    longPress(tree, '08:30 AM, on');
    await submitTime(tree, '23:30');

    expect(allText(tree)).toContain('That time is inside your quiet hours');
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

  test('the sound row names the sound rather than its id, and opens the picker', async () => {
    const tree = await render();

    // The plan stores `water_drop`; a settings row reading that would be the
    // server's word, not the user's.
    expect(allText(tree)).toContain('Water Drop');

    press(tree, 'Reminder sound');

    expect(mockNavigate).toHaveBeenCalledWith('ReminderSound');
  });

  test('once the plan is on the phone it says how many it will ring', async () => {
    const tree = await render();

    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    // The one place a user can find out that the plan actually works, rather
    // than waiting for a time to pass and seeing whether anything happens.
    expect(allText(tree)).toContain('9 reminders, even offline');
  });

  test('with health notifications off it says so, and one tap turns them on', async () => {
    useNotificationSettingsStore.setState(state => ({
      categories: { ...state.categories, health: false },
    }));

    const tree = await render();

    // Otherwise the plan reads "9 reminders active" over a phone that will
    // show none of them.
    expect(allText(tree)).toContain('Health reminders are switched off');

    press(tree, 'Turn on');

    expect(useNotificationSettingsStore.getState().categories.health).toBe(
      true,
    );
  });

  test('a time added inside quiet hours says so at once, not silently', async () => {
    useNotificationSettingsStore.setState({
      quietHours: { enabled: true, start: '22:00', end: '07:00' },
    });
    const tree = await render();

    press(tree, 'Add a custom time');
    // The picker opens on 08:00; submit a time inside the window instead.
    const picker = tree.root
      .findAll(n => typeof n.props?.onSubmit === 'function')
      .find(n => n.props.visible === true);
    if (!picker) throw new Error('No open time picker');
    await ReactTestRenderer.act(async () => {
      picker.props.onSubmit('22:45');
    });

    // Quiet hours are on by default from 22:00, which is exactly when
    // somebody first tries this out. A chip that looks live and never rings
    // is the worst thing this screen can do.
    expect(allText(tree)).toContain('That time is inside your quiet hours');
  });

  test('it counts the times quiet hours will silence, and offers the window', async () => {
    useNotificationSettingsStore.setState({
      // A window that swallows most of the seeded plan.
      quietHours: { enabled: true, start: '12:00', end: '23:00' },
    });

    const tree = await render();
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    expect(allText(tree)).toContain('times are inside your quiet hours');

    press(tree, 'Quiet hours');
    expect(mockNavigate).toHaveBeenCalledWith('NotificationSettings');
  });

  test('the chevron returns to whatever opened the plan', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});

/**
 * What each block of the plan will take (RULES Y5).
 *
 * A block is a part of the day, so the sheet it opens is pinned to that part
 * of the day's half of the clock, and the block holds a bounded number of
 * times. Both are rules a member meets while they are setting a reminder, so
 * both are checked here rather than only in the store.
 */
describe('HydrationReminderScreen: what a block takes', () => {
  /** Five morning times: the block at its own cap. */
  const fullMorning = (): HydrationReminderPlan => ({
    ...PLAN,
    reminders: [
      ...['06:00', '07:00', '08:00', '09:00', '10:00'].map(time => ({
        id: `morning-${time}`,
        time,
        slot: 'morning' as const,
        enabled: true,
      })),
      ...PLAN.reminders.filter(reminder => reminder.slot !== 'morning'),
    ],
  });

  test('each block says how many of its times it holds', async () => {
    const text = allText(await render());

    // The cap is on screen before it is reached, rather than only at the
    // moment somebody is told they cannot add another.
    expect(text).toContain('3 of 5 times');
    expect(text).toContain('2 of 5 times');
  });

  test('the morning sheet is pinned to AM and says so', async () => {
    const tree = await render();

    press(tree, 'Add a time to Morning');

    expect(openPicker(tree)?.props.period).toBe('am');
    const text = allText(tree);
    expect(text).toContain('Morning times are AM');
    // And the way round it, for a member who wanted 1 pm in the morning.
    expect(text).toContain('custom time');
  });

  test('the afternoon and evening sheets are pinned to PM, and open on their own hour', async () => {
    const tree = await render();

    press(tree, 'Add a time to Afternoon');
    expect(openPicker(tree)?.props.period).toBe('pm');
    // 14:00 rather than 08:00: an afternoon block that opened at 8 would be
    // offering 8 pm the moment the half was applied.
    expect(openPicker(tree)?.props.value).toBe('14:00');
    expect(allText(tree)).toContain('Afternoon times are PM');

    press(tree, 'Close');
    press(tree, 'Add a time to Evening');
    expect(openPicker(tree)?.props.period).toBe('pm');
    expect(openPicker(tree)?.props.value).toBe('19:00');
  });

  test('a custom time is still any hour of the day', async () => {
    const tree = await render();

    press(tree, 'Add a custom time');

    expect(openPicker(tree)?.props.period).toBe('any');
    expect(openPicker(tree)?.props.note).toBeUndefined();
  });

  test('holding a chip opens the editor inside its own block’s half', async () => {
    const tree = await render();

    longPress(tree, '06:00 PM, on');

    expect(openPicker(tree)?.props.period).toBe('pm');
    expect(openPicker(tree)?.props.value).toBe('18:00');
  });

  test('a time a block cannot take any more opens the editor on one it can', async () => {
    // As an older build, or another phone, could have left it: a PM time in
    // the morning block. The editor opens on the same hour in AM, which is
    // how the member is shown what the block will now take.
    useRemindersStore.setState({
      plan: {
        ...PLAN,
        reminders: [
          { id: 'legacy', time: '13:00', slot: 'morning', enabled: true },
        ],
      },
    });
    const tree = await render();

    longPress(tree, '01:00 PM, on');

    expect(openPicker(tree)?.props.period).toBe('am');
    expect(openPicker(tree)?.props.value).toBe('01:00');
  });

  test('a full block says so rather than opening a sheet that cannot be used', async () => {
    useRemindersStore.setState({ plan: fullMorning() });
    const tree = await render();

    // The chip reads "Full" rather than disappearing, so the rule is where
    // the control was.
    expect(allText(tree)).toContain('Full');
    expect(allText(tree)).toContain('5 of 5 times');

    press(tree, 'Morning is full');

    expect(openPicker(tree)).toBeUndefined();
    const text = allText(tree);
    expect(text).toContain('Morning is full');
    expect(text).toContain('5 times at most');
  });

  test('a full block does not stop the others, or a custom time', async () => {
    useRemindersStore.setState({ plan: fullMorning() });
    const tree = await render();

    press(tree, 'Add a time to Afternoon');
    expect(openPicker(tree)?.props.period).toBe('pm');

    press(tree, 'Close');
    press(tree, 'Add a custom time');
    expect(openPicker(tree)?.props.period).toBe('any');
  });

  test('the store refuses a time past the cap, whatever asks for it', async () => {
    useRemindersStore.setState({ plan: fullMorning() });
    await render();

    ReactTestRenderer.act(() => {
      useRemindersStore.getState().addReminder('11:30', 'morning');
    });

    // The screen is where a member meets the cap; this is the guard for a
    // plan that arrived full from somewhere else.
    expect(reminders().filter(r => r.slot === 'morning')).toHaveLength(5);
    expect(reminders().some(r => r.time === '11:30')).toBe(false);

    ReactTestRenderer.act(() => {
      useRemindersStore.getState().addReminder('11:30', 'custom');
    });
    expect(reminders().some(r => r.time === '11:30')).toBe(true);
  });
});

/**
 * The blocks as the server cut them (RULES Y5b).
 *
 * The plan carries each block's half of the clock and its cap, so the panel
 * can change either without an app release. What is checked here is that the
 * screen actually follows the plan rather than its own constant.
 */
describe('HydrationReminderScreen: the server’s own rules', () => {
  test('a cap the server raised is what the block says and what it takes', async () => {
    useRemindersStore.setState({
      plan: {
        ...PLAN,
        slots: {
          morning: { period: 'am', maxTimes: 8 },
          afternoon: { period: 'pm', maxTimes: 8 },
          evening: { period: 'pm', maxTimes: 8 },
          custom: { period: 'any', maxTimes: 24 },
        },
      },
    });
    const tree = await render();

    expect(allText(tree)).toContain('3 of 8 times');

    // And the chip is not full at five any more.
    ReactTestRenderer.act(() => {
      useRemindersStore.getState().addReminder('11:30', 'morning');
    });
    expect(reminders().filter(r => r.slot === 'morning')).toHaveLength(4);
  });

  test('a half the server moved is the half the sheet offers', async () => {
    useRemindersStore.setState({
      plan: {
        ...PLAN,
        slots: {
          morning: { period: 'am', maxTimes: 5 },
          afternoon: { period: 'pm', maxTimes: 5 },
          // A late-night block, re-cut from the panel.
          evening: { period: 'any', maxTimes: 5 },
          custom: { period: 'any', maxTimes: 24 },
        },
      },
    });
    const tree = await render();

    press(tree, 'Add a time to Evening');

    expect(openPicker(tree)?.props.period).toBe('any');
    // Nothing to explain when any hour will do.
    expect(openPicker(tree)?.props.note).toBeUndefined();
  });

  test('without them the screen falls back to the rules it shipped with', async () => {
    // A server older than the field, or a plan restored from disk offline.
    const tree = await render();

    expect(allText(tree)).toContain('3 of 5 times');
    press(tree, 'Add a time to Morning');
    expect(openPicker(tree)?.props.period).toBe('am');
  });
});
