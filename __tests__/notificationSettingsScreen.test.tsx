/**
 * The screen is consent: every switch writes straight through, there is
 * nothing to save, and the copy beside each one is what the user is agreeing
 * to. The checks here are that the switches reach the store, that "Enable All"
 * cannot lie about what it will do, and that the quiet window is edited
 * without the sheet losing its place.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { NotificationSettingsScreen } from '../src/screens/main/NotificationSettingsScreen';
import { CATEGORY_STYLE } from '../src/components/settings/notificationCategories';
import { ThemeProvider } from '../src/theme';
import {
  NOTIFICATION_CATEGORIES,
  useNotificationSettingsStore,
} from '../src/stores/notificationSettingsStore';

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
  useNotificationSettingsStore.getState().reset();
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
          <NotificationSettingsScreen />
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

const toggle = (
  tree: ReactTestRenderer.ReactTestRenderer,
  prefix: string,
  next: boolean,
) => {
  const node = tree.root
    .findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        (n.props.accessibilityLabel as string).startsWith(prefix) &&
        typeof n.props.onValueChange === 'function',
    )[0];

  if (!node) throw new Error(`No switch labelled "${prefix}…"`);
  ReactTestRenderer.act(() => node.props.onValueChange(next));
};

describe('NotificationSettingsScreen', () => {
  test('every category is on screen with the copy that explains it', async () => {
    const text = allText(await render());

    for (const key of NOTIFICATION_CATEGORIES) {
      expect(text).toContain(CATEGORY_STYLE[key].title);
      expect(text).toContain(CATEGORY_STYLE[key].description);
    }
  });

  test('a category switch writes straight through, with nothing to save', async () => {
    const tree = await render();

    toggle(tree, 'Activity & Steps', false);

    expect(useNotificationSettingsStore.getState().categories.activity).toBe(
      false,
    );
  });

  test('Enable All turns on the ones that were off', async () => {
    const tree = await render();
    // Health starts off, which is what gives the link something to do.
    expect(useNotificationSettingsStore.getState().categories.health).toBe(false);

    press(tree, 'Enable all notification categories');

    const { categories } = useNotificationSettingsStore.getState();
    expect(NOTIFICATION_CATEGORIES.every(key => categories[key])).toBe(true);
  });

  test('Enable All goes quiet once there is nothing left to enable', async () => {
    const tree = await render();
    press(tree, 'Enable all notification categories');

    const link = tree.root
      .findAll(n => n.props?.accessibilityLabel === 'Enable all notification categories')
      .find(n => n.props?.accessibilityState?.disabled !== undefined);

    expect(link?.props.accessibilityState.disabled).toBe(true);
  });

  test('the quiet window is stated in the row, not just inside the sheet', async () => {
    expect(allText(await render())).toContain('10:00 PM – 07:00 AM');
  });

  test('quiet hours can be switched off from its own sheet', async () => {
    const tree = await render();
    press(tree, 'Quiet hours,');

    toggle(tree, 'Quiet hours', false);

    expect(useNotificationSettingsStore.getState().quietHours.enabled).toBe(
      false,
    );
    expect(allText(tree)).toContain('Always on');
  });

  test('changing the start time keeps the sheet open on its summary', async () => {
    const tree = await render();
    press(tree, 'Quiet hours,');
    press(tree, 'Start,');

    // The picker took over the sheet rather than opening a second one over it.
    expect(allText(tree)).toContain('Set time');

    press(tree, 'Set time');

    expect(allText(tree)).toContain('Start');
    expect(useNotificationSettingsStore.getState().quietHours.start).toBe(
      '22:00',
    );
  });

  test('email and SMS are separate consents', async () => {
    const tree = await render();

    toggle(tree, 'Email notifications', true);
    toggle(tree, 'Delivery updates via SMS', false);

    const state = useNotificationSettingsStore.getState();
    expect(state.email).toBe(true);
    expect(state.sms).toBe(false);
  });

  test('the chevron returns to whatever opened the settings', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
