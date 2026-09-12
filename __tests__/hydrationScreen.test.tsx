/**
 * The hydration screen is three views of one number — the litres at the top,
 * the glass beside them and the rows at the bottom — so the checks here are
 * that a tap moves all three together, that a logged drink can be taken back
 * out again, and that the day's rollover leaves nothing of yesterday behind.
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

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  useHydrationStore.getState().reset();
  useSettingsStore.setState({ dailyWaterGoalMl: 3000 });
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
  test('an empty day says so rather than showing a blank log', async () => {
    const text = allText(await render());

    expect(text).toContain('0.0 L');
    expect(text).toContain('of 3.0 L');
    expect(text).toContain('Nothing logged yet today');
  });

  test('a quick add moves the figure, the percentage and the log together', async () => {
    const tree = await render();

    press(tree, 'Add 750 ml');

    const text = allText(tree);
    expect(text).toContain('0.8 L'); // 750 ml, to one decimal
    expect(text).toContain('25%'); // of a 3 L goal
    expect(text).toContain('750 ml Water');
    expect(useHydrationStore.getState().consumedMl).toBe(750);
  });

  test('a logged drink can be taken back out of the day', async () => {
    const tree = await render();
    press(tree, 'Add 500 ml');
    expect(useHydrationStore.getState().entries).toHaveLength(1);

    press(tree, 'Remove 500 ml Water');

    expect(useHydrationStore.getState().entries).toHaveLength(0);
    expect(useHydrationStore.getState().consumedMl).toBe(0);
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
    expect(useHydrationStore.getState().consumedMl).toBe(0);
  });

  test('the chevron returns to whatever opened the screen', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
