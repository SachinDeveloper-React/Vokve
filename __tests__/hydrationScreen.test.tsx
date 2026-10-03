/**
 * The hydration screen is three views of one number — the litres at the top,
 * the glass beside them and the rows at the bottom — so the checks here are
 * that a tap moves all three together before the server has answered, that a
 * logged drink can be taken back out again, and that the habit figures and
 * the tip are the server's. The API is the mock backend's own, served without
 * latency.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { HydrationScreen } from '../src/screens/main/HydrationScreen';
import { ThemeProvider } from '../src/theme';
import { useHydrationStore } from '../src/stores/hydrationStore';
import { useSettingsStore } from '../src/stores/settingsStore';
import { clearServerReads } from '../src/hooks/useServerRead';
import { mockAuthApi } from '../src/services/api/mockApi';
import { todayIso } from '../src/utils/date';

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

// The mock backend's own water and tips, behind spies.
jest.mock('../src/services/api/endpoints', () => {
  const api = jest.requireActual('../src/services/api/mockApi');
  return {
    hydrationApi: {
      today: jest.fn(() => api.mockHydrationApi.today()),
      log: jest.fn((entry: unknown, options: unknown) =>
        api.mockHydrationApi.log(entry, options),
      ),
      remove: jest.fn((id: string, options: unknown) =>
        api.mockHydrationApi.remove(id, options),
      ),
      stats: jest.fn(() => api.mockHydrationApi.stats()),
    },
    contentApi: {
      tip: jest.fn((topic: string) => api.mockContentApi.tip(topic)),
    },
  };
});

const { hydrationApi } = jest.requireMock('../src/services/api/endpoints') as {
  hydrationApi: {
    today: jest.Mock;
    log: jest.Mock;
    remove: jest.Mock;
    stats: jest.Mock;
  };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(async () => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  clearServerReads();
  // Signing out is the mock backend's own reset.
  await mockAuthApi.signOut();
  useHydrationStore.getState().reset();
  // Today, as a finished sync leaves it: nothing drunk yet.
  useHydrationStore.setState({
    day: { date: todayIso(), consumedMl: 0, goalMl: 3000, entries: [] },
    syncedAt: new Date().toISOString(),
  });
  useSettingsStore.setState({ dailyWaterGoalMl: 3000 });
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

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <HydrationScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  await settle();
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

describe('HydrationScreen', () => {
  test('before the first answer it says it is loading, not that nothing was drunk', async () => {
    useHydrationStore.getState().reset();
    const text = allText(await render());

    expect(text).not.toContain('0.0 L');
    expect(text).not.toContain('Nothing logged yet today');
  });

  test("the habit figures and the tip are the server's", async () => {
    const text = allText(await render());

    expect(hydrationApi.stats).toHaveBeenCalled();
    expect(text).toContain('85%');
    expect(text).toContain("Drink water regularly; don't wait until thirsty.");
  });

  test('an empty day says so rather than showing a blank log', async () => {
    const text = allText(await render());

    expect(text).toContain('0.0 L');
    expect(text).toContain('of 3.0 L');
    expect(text).toContain('Nothing logged yet today');
  });

  test('a quick add moves the figure, the percentage and the log together', async () => {
    const tree = await render();

    press(tree, 'Add 750 ml');

    // At once, before the server has answered.
    const text = allText(tree);
    expect(text).toContain('0.8 L'); // 750 ml, to one decimal
    expect(text).toContain('25%'); // of a 3 L goal
    expect(text).toContain('750 ml Water');

    await settle();
    expect(hydrationApi.log).toHaveBeenCalledWith(
      expect.objectContaining({ ml: 750 }),
      { idempotencyKey: expect.stringMatching(/^drink:/) },
    );
    expect(useHydrationStore.getState().day?.consumedMl).toBe(750);
  });

  test('a logged drink can be taken back out of the day', async () => {
    const tree = await render();
    press(tree, 'Add 500 ml');
    await settle();
    expect(useHydrationStore.getState().day?.entries).toHaveLength(1);

    press(tree, 'Remove 500 ml Water');
    await settle();

    expect(hydrationApi.remove).toHaveBeenCalled();
    expect(useHydrationStore.getState().day?.entries).toHaveLength(0);
    expect(allText(tree)).toContain('Nothing logged yet today');
  });

  test('a litre is logged as a litre, not as 1000 ml', async () => {
    const tree = await render();

    press(tree, 'Add 1 L');

    expect(allText(tree)).toContain('1 L Water');
  });

  test('the encouragement follows the figure rather than always cheering', async () => {
    const tree = await render();
    expect(allText(tree)).toContain('Time for your first glass');

    press(tree, 'Add 750 ml');
    press(tree, 'Add 750 ml');
    press(tree, 'Add 750 ml');

    expect(allText(tree)).toContain("You're doing great");
  });

  test('the custom tile opens a sheet instead of logging something', async () => {
    const tree = await render();

    press(tree, 'Add a custom amount');

    expect(allText(tree)).toContain('Custom amount');
    expect(useHydrationStore.getState().outbox).toEqual([]);
  });

  test('the clock in the header opens the reminder plan', async () => {
    press(await render(), 'Hydration reminders');

    expect(mockNavigate).toHaveBeenCalledWith('HydrationReminder');
  });

  test('the chevron returns to whatever opened the screen', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
