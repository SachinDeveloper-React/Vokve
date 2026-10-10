/**
 * Choosing what a reminder sounds like (RULES Y5).
 *
 * The screen has one job and two ways to get it wrong: offering a sound the
 * app has no audio for, and making the user choose one to hear it. Both are
 * checked here, along with the save — a tap is the choice, because there is
 * nothing on this screen anybody would want to change and then abandon.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { ReminderSoundScreen } from '../src/screens/main/ReminderSoundScreen';
import { ThemeProvider } from '../src/theme';
import { ToastProvider } from '../src/components/feedback';
import { useRemindersStore } from '../src/stores/remindersStore';
import { clearServerReads } from '../src/hooks/useServerRead';
import type { HydrationReminderPlan } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
}));

jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    mockLatencyMs: 0,
  },
}));

jest.mock('../src/services/notifications', () => ({
  previewReminderSound: jest.fn(async () => 'played'),
}));

jest.mock('../src/services/api/endpoints', () => {
  const api = jest.requireActual('../src/services/api/mockApi');
  return {
    hydrationApi: {
      reminderSounds: jest.fn(() => api.mockHydrationApi.reminderSounds()),
      saveReminders: jest.fn((plan: unknown, options: unknown) =>
        api.mockHydrationApi.saveReminders(plan, options),
      ),
    },
  };
});

const { previewReminderSound } = jest.requireMock(
  '../src/services/notifications',
) as { previewReminderSound: jest.Mock };

const { hydrationApi } = jest.requireMock('../src/services/api/endpoints') as {
  hydrationApi: { reminderSounds: jest.Mock; saveReminders: jest.Mock };
};

const PLAN: HydrationReminderPlan = {
  enabled: true,
  sound: 'water_drop',
  vibration: true,
  repeatDays: [0, 1, 2, 3, 4, 5, 6],
  reminders: [{ id: 'a', time: '10:00', slot: 'morning', enabled: true }],
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
  previewReminderSound.mockClear();
  hydrationApi.reminderSounds.mockClear();
  hydrationApi.saveReminders.mockClear();
  useRemindersStore.getState().reset();
  useRemindersStore.setState({ plan: PLAN, syncedAt: new Date().toISOString() });
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
          <ToastProvider>
            <ReminderSoundScreen />
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

/**
 * Which row reports itself as the chosen one.
 *
 * De-duplicated: a `Pressable` carries its accessibility props on several
 * nodes of the tree it renders, so one row matches more than once.
 */
const selectedLabels = (tree: ReactTestRenderer.ReactTestRenderer) => [
  ...new Set(
    tree.root
      .findAll(n => n.props?.accessibilityRole === 'radio')
      .filter(n => n.props.accessibilityState?.selected)
      .map(n => String(n.props.accessibilityLabel)),
  ),
];

describe('ReminderSoundScreen', () => {
  test('lists the server’s sounds and marks the one in the plan', async () => {
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('Water Drop');
    expect(text).toContain('Chime');
    expect(text).toContain('Silent');
    expect(selectedLabels(tree)).toEqual([
      expect.stringContaining('Water Drop'),
    ]);
  });

  test('a tap is the choice, and it is sent to the server at once', async () => {
    const tree = await render();

    press(tree, 'Chime');

    expect(useRemindersStore.getState().plan?.sound).toBe('chime');
    expect(hydrationApi.saveReminders).toHaveBeenCalledWith(
      expect.objectContaining({ sound: 'chime' }),
      { idempotencyKey: expect.any(String) },
    );
    expect(selectedLabels(tree)).toEqual([expect.stringContaining('Chime')]);
  });

  test('choosing a sound plays it, so the choice confirms itself', async () => {
    const tree = await render();

    press(tree, 'Bell');

    expect(previewReminderSound).toHaveBeenCalledWith('bell', true);
  });

  test('a sound can be heard without being chosen', async () => {
    const tree = await render();

    press(tree, 'Play Chime');

    expect(previewReminderSound).toHaveBeenCalledWith('chime', true);
    // The plan is untouched: listening is not deciding.
    expect(useRemindersStore.getState().plan?.sound).toBe('water_drop');
  });

  test('the preview carries the plan’s vibration setting, not a guess', async () => {
    useRemindersStore.setState({ plan: { ...PLAN, vibration: false } });
    const tree = await render();

    press(tree, 'Play Bell');

    expect(previewReminderSound).toHaveBeenCalledWith('bell', false);
  });

  test('offers only sounds this build can actually play', async () => {
    // A release of the server may name a sound before the app carries it.
    hydrationApi.reminderSounds.mockResolvedValueOnce([
      { id: 'chime', label: 'Chime', description: 'Two soft notes' },
      { id: 'air_horn', label: 'Air Horn', description: 'Loud' },
    ]);

    const text = allText(await render());

    expect(text).toContain('Chime');
    expect(text).not.toContain('Air Horn');
  });

  test('a list that never arrives still offers the bundled sounds', async () => {
    hydrationApi.reminderSounds.mockRejectedValueOnce(new Error('offline'));

    const text = allText(await render());

    // An empty picker would read as "this phone cannot change its sound".
    expect(text).toContain('Water Drop');
    expect(text).toContain('Default');
  });

  test('a preview that could not ring says why, rather than being silent', async () => {
    // Silence is the one answer a play button must never give on its own: it
    // could be the sound, the volume, the permission or a bug.
    previewReminderSound.mockResolvedValueOnce('not_permitted');
    const tree = await render();

    press(tree, 'Play Chime');
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    expect(allText(tree)).toContain('Notifications are turned off');
  });

  test('a sound the phone refuses is reported as that, not as a permission', async () => {
    previewReminderSound.mockResolvedValueOnce('failed');
    const tree = await render();

    press(tree, 'Play Bell');
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    expect(allText(tree)).toContain('could not be played');
  });

  test('a preview that rings says nothing — the sound is the feedback', async () => {
    const tree = await render();

    press(tree, 'Play Chime');
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    expect(allText(tree)).not.toContain('could not be played');
    expect(allText(tree)).not.toContain('Notifications are turned off');
  });

  test('the chevron returns to the plan', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
