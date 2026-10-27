/**
 * The app's screens are root-stack routes, so they sit over the real tab bar
 * rather than inside it — which is what keeps a tab leading to its own screen
 * and nothing else. Each of those screens therefore draws a bar of its own,
 * and the checks here are the three things that makes load-bearing: that a
 * screen in the shell has one, that a screen with a real bar beneath it does
 * not, and that pressing a tab goes to that tab's own screen.
 *
 * @format
 */

import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text as RNText,
  type ViewStyle,
} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import {
  AppTabBar,
  focusedTabOf,
} from '../src/components/navigation/AppTabBar';
import { Screen } from '../src/components/ui/Screen';
import { AppText } from '../src/components/ui/AppText';
import { NavigatorTabBar } from '../src/navigation/JsTabNavigator';
import {
  InAppShellContext,
  TabBarBelowContext,
} from '../src/navigation/shellTabs';
import { TAB_ITEMS } from '../src/navigation/tabItems';
import { ThemeProvider } from '../src/theme';

const mockNavigate = jest.fn();

/** The root stack, with `Main` parked on whichever tab a test wants. */
let mockState: unknown = {
  index: 1,
  routes: [
    { name: 'Main', state: { index: 0, routes: [{ name: 'Home' }] } },
    { name: 'Analytics' },
  ],
};

// Only the two navigation hooks are replaced: the theme layer imports
// `DefaultTheme` from this same module, and a blanket mock takes that down
// with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
  useNavigationState: (selector: (value: unknown) => unknown) =>
    selector(mockState),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 34 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockState = {
    index: 1,
    routes: [
      { name: 'Main', state: { index: 0, routes: [{ name: 'Home' }] } },
      { name: 'Analytics' },
    ],
  };
});

afterEach(() => {
  const tree = mounted;
  mounted = null;
  if (tree) {
    ReactTestRenderer.act(() => tree.unmount());
  }
});

const render = (node: React.ReactNode) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>{node}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

/** Every tab item on screen, by the word under its glyph. */
const tabs = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll(
      node =>
        typeof node.props?.accessibilityLabel === 'string' &&
        typeof node.props?.onPress === 'function' &&
        TAB_ITEMS.some(item => item.title === node.props.accessibilityLabel),
    )
    .map(node => node.props);

const press = (tree: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const tab = tabs(tree).find(props => props.accessibilityLabel === label);
  if (!tab) throw new Error(`No tab labelled "${label}"`);
  ReactTestRenderer.act(() => tab.onPress());
};

describe('focusedTabOf', () => {
  test('reads the tab Main is parked on', () => {
    expect(
      focusedTabOf({
        index: 0,
        routes: [
          {
            name: 'Main',
            state: {
              index: 2,
              routes: [{ name: 'Home' }, { name: 'Wallet' }, { name: 'Shop' }],
            },
          },
        ],
      } as never),
    ).toBe('Shop');
  });

  test('falls back to the first tab before Main has any state', () => {
    // A screen opened cold by a notification tap has a stack whose Main has
    // not been drawn yet; a bar with nothing lit would read as broken.
    expect(
      focusedTabOf({ index: 0, routes: [{ name: 'Main' }] } as never),
    ).toBe('Home');
    expect(focusedTabOf(undefined)).toBe('Home');
  });
});

describe('AppTabBar', () => {
  test('draws every tab, with the one Main is on selected', () => {
    mockState = {
      index: 1,
      routes: [
        {
          name: 'Main',
          state: { index: 1, routes: [{ name: 'Home' }, { name: 'Wallet' }] },
        },
        { name: 'Analytics' },
      ],
    };
    const tree = render(<AppTabBar />);

    expect(tabs(tree).map(props => props.accessibilityLabel)).toEqual(
      TAB_ITEMS.map(item => item.title),
    );
    const selected = tabs(tree).filter(
      props => props.accessibilityState?.selected,
    );
    expect(selected.map(props => props.accessibilityLabel)).toEqual(['Coins']);
  });

  test('a tab goes to that tab’s own screen, not to what it last opened', () => {
    const tree = render(<AppTabBar />);

    press(tree, 'Shop');
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Shop' });

    // Account is a stack, so it is named down to its landing screen.
    press(tree, 'Account');
    expect(mockNavigate).toHaveBeenLastCalledWith('Main', {
      screen: 'Account',
      params: { screen: 'AccountHome' },
    });
  });
});

describe('NavigatorTabBar', () => {
  /** The library's own props, as the navigator hands them to a custom bar. */
  const navigatorProps = (prevented = false) => ({
    state: {
      index: 0,
      routes: TAB_ITEMS.map(item => ({
        key: `${item.name}-1`,
        name: item.name,
      })),
    },
    navigation: {
      emit: jest.fn(() => ({ defaultPrevented: prevented })),
      navigate: jest.fn(),
    },
    descriptors: {},
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  test('a press emits tabPress and then switches tab', () => {
    // The library's bar does both, and replacing it means taking them on:
    // `tabPress` is the event a screen listens for to scroll its list home.
    const props = navigatorProps();
    const tree = render(<NavigatorTabBar {...(props as never)} />);

    press(tree, 'Shop');

    expect(props.navigation.emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'Shop-1',
      canPreventDefault: true,
    });
    expect(props.navigation.navigate).toHaveBeenCalledWith('Shop', undefined);
  });

  test('a screen that swallows tabPress stops the move', () => {
    const props = navigatorProps(true);
    const tree = render(<NavigatorTabBar {...(props as never)} />);

    press(tree, 'Shop');

    expect(props.navigation.navigate).not.toHaveBeenCalled();
  });
});

describe('Screen', () => {
  const content = (
    <Screen>
      <AppText>Water log</AppText>
    </Screen>
  );

  test('a screen in the app carries the tab bar', () => {
    const tree = render(
      <InAppShellContext.Provider value={true}>
        {content}
      </InAppShellContext.Provider>,
    );

    expect(tabs(tree)).toHaveLength(TAB_ITEMS.length);
    expect(textOf(tree, RNText)).toContain('Water log');
  });

  test('a scrollable gets room at its foot for the bar lying over it', () => {
    // The bar is an overlay, so a list that ran to the bottom of the screen
    // would keep its last row under the glass for good. `Screen` adds the
    // room rather than sixty screens each knowing the bar's height.
    const list = (
      <Screen>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <AppText>Last row</AppText>
        </ScrollView>
      </Screen>
    );

    const inApp = render(
      <InAppShellContext.Provider value={true}>
        {list}
      </InAppShellContext.Provider>,
    );
    const padded = StyleSheet.flatten(
      inApp.root.findByType(ScrollView).props.contentContainerStyle,
    );
    // Its own 40 is kept and the bar's room added to it, not replaced.
    expect(padded.paddingBottom).toBeGreaterThan(40);

    // Nothing added where no bar is drawn.
    const plain = render(list);
    const untouched = StyleSheet.flatten(
      plain.root.findByType(ScrollView).props.contentContainerStyle,
    );
    expect(untouched.paddingBottom).toBe(40);
  });

  test('a screen that is a task in progress can take the bar off', () => {
    // A workout being logged and a payment being taken: a tab press leaves by
    // throwing the task away, and nothing offers a way back into it.
    const tree = render(
      <InAppShellContext.Provider value={true}>
        <Screen tabBar={false}>
          <AppText>Logging sets</AppText>
        </Screen>
      </InAppShellContext.Provider>,
    );

    expect(tabs(tree)).toHaveLength(0);
    expect(textOf(tree, RNText)).toContain('Logging sets');
  });

  test('a tab’s own screen draws no second bar', () => {
    // A bar is already under it — UIKit's on iOS, the navigator's capsule on
    // Android — and two bars is the bug this context exists to stop.
    for (const below of ['overlay', 'platform'] as const) {
      const tree = render(
        <InAppShellContext.Provider value={true}>
          <TabBarBelowContext.Provider value={below}>
            {content}
          </TabBarBelowContext.Provider>
        </InAppShellContext.Provider>,
      );

      expect(tabs(tree)).toHaveLength(0);
    }
  });

  test('a tab’s own screen still leaves room for a capsule over it', () => {
    // The navigator's bar is the same floating capsule and reserves nothing,
    // so a tab screen's list needs the room as much as a pushed screen's.
    // This is what left Home's last row under the glass.
    const list = (
      <Screen>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <AppText>Last row</AppText>
        </ScrollView>
      </Screen>
    );
    const under = (below: 'overlay' | 'platform') =>
      StyleSheet.flatten(
        render(
          <InAppShellContext.Provider value={true}>
            <TabBarBelowContext.Provider value={below}>
              {list}
            </TabBarBelowContext.Provider>
          </InAppShellContext.Provider>,
        ).root.findByType(ScrollView).props.contentContainerStyle,
      );

    expect(under('overlay').paddingBottom).toBeGreaterThan(40);
    // UIKit's bar is laid out by the platform, which has already taken its
    // room out of the screen; reserving it again would leave a gap.
    expect(under('platform').paddingBottom).toBe(40);
  });

  test('a screen with nothing scrollable stops above the bar', () => {
    // Fallback: there is no content container to hang the room on, so the
    // whole content box ends above the capsule. That screen loses the
    // page-under-glass look and keeps all of its content.
    const tree = render(
      <InAppShellContext.Provider value={true}>
        <Screen>
          <AppText>Fixed page</AppText>
        </Screen>
      </InAppShellContext.Provider>,
    );

    // The content box, told apart from the bar's own strip by its flex.
    const box = tree.root.findAll(node => {
      const flat = StyleSheet.flatten(node.props?.style) as
        | ViewStyle
        | undefined;
      return flat?.flex === 1 && typeof flat?.paddingBottom === 'number';
    });

    expect(box).not.toHaveLength(0);
    expect(
      (StyleSheet.flatten(box[0].props.style) as ViewStyle).paddingBottom,
    ).toBeGreaterThan(0);
  });

  test('an auth or onboarding screen has no bar at all', () => {
    // Nothing provides the shell context outside the signed-in stack, so the
    // default is what those screens get.
    expect(tabs(render(content))).toHaveLength(0);
  });
});
