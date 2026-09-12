/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf as collectText } from './helpers/text';
import { HomeHeader } from '../src/components/home/HomeHeader';
import { Wordmark } from '../src/components/brand/Wordmark';
import { Avatar } from '../src/components/media/Avatar';
import { ThemeProvider, lightColors } from '../src/theme';

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const render = async (node: React.ReactNode) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>{node}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  collectText(tree, Text);

const flatten = (style: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const visit = (s: unknown) => {
    if (Array.isArray(s)) return s.forEach(visit);
    if (s && typeof s === 'object') Object.assign(out, s);
  };
  visit(style);
  return out;
};

const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');

describe('Wordmark', () => {
  test('renders the whole name', async () => {
    const tree = await render(<Wordmark />);
    expect(allText(tree).replace(/\s/g, '')).toContain('VOKVE');
  });

  test('splits the two halves across the brand colours', async () => {
    const tree = await render(<Wordmark />);
    const colors = tree.root
      .findAllByType(Text)
      .map(n => flatten(n.props.style).color);

    expect(colors).toContain(lightColors.brand);
    expect(colors).toContain(lightColors.brandAccent);
  });

  test('does not scale with the OS font setting', async () => {
    const tree = await render(<Wordmark />);
    // A logo that grows with the text setting pushes the header actions off
    // the row, so it is pinned.
    expect(tree.root.findAllByType(Text)[0].props.allowFontScaling).toBe(false);
  });

  test('is announced as a header, not as loose letters', async () => {
    const tree = await render(<Wordmark />);
    const outer = tree.root.findAllByType(Text)[0];

    expect(outer.props.accessibilityRole).toBe('header');
    expect(outer.props.accessibilityLabel).toBe('vokve');
  });
});

describe('Avatar ring', () => {
  test('keeps the portrait at the requested size', async () => {
    const plain = await render(<Avatar name="Aman Verma" size="md" />);
    const ringed = await render(<Avatar name="Aman Verma" size="md" ring />);

    const innerOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
      tree.root
        .findAllByType(View)
        .map(n => flatten(n.props.style))
        .find(s => typeof s.width === 'number' && s.backgroundColor);

    // The ring grows an outer box rather than squeezing the portrait.
    expect(innerOf(ringed)?.width).toBe(innerOf(plain)?.width);
  });

  test('uses the brand accent by default and honours an override', async () => {
    const branded = await render(<Avatar name="Aman" ring />);
    const custom = await render(<Avatar name="Aman" ring="#00ff00" />);

    const ringColorOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
      tree.root
        .findAllByType(View)
        .map(n => flatten(n.props.style))
        .find(s => typeof s.borderWidth === 'number' && s.borderColor)
        ?.borderColor;

    expect(ringColorOf(branded)).toBe(lightColors.brandAccent);
    expect(ringColorOf(custom)).toBe('#00ff00');
  });
});

describe('HomeHeader', () => {
  const handlers = {
    onPressNotifications: jest.fn(),
    onPressAvatar: jest.fn(),
  };

  beforeEach(() => {
    handlers.onPressNotifications.mockClear();
    handlers.onPressAvatar.mockClear();
  });

  test('greets the user by first name only', async () => {
    const tree = await render(<HomeHeader name="Aman Verma" {...handlers} />);

    expect(allText(tree)).toContain('Hello, Aman!');
    expect(allText(tree)).not.toContain('Verma');
  });

  test('keeps a greeting while the profile is still loading', async () => {
    const tree = await render(<HomeHeader name={null} {...handlers} />);

    // A blank line here would collapse the header and shift everything below
    // it once the name arrives.
    expect(allText(tree)).toContain('Welcome!');
    expect(allText(tree)).toContain('Stay active, stay healthy!');
  });

  test('announces unread notifications in the button label', async () => {
    const quiet = await render(<HomeHeader name="Aman" {...handlers} />);
    expect(byLabel(quiet, 'Notifications')).toBeDefined();

    const unread = await render(
      <HomeHeader name="Aman" hasUnreadNotifications {...handlers} />,
    );
    // The red dot is decorative, so the state has to reach the label.
    expect(byLabel(unread, 'Notifications, unread')).toBeDefined();
  });

  test('routes the two header actions separately', async () => {
    const tree = await render(<HomeHeader name="Aman" {...handlers} />);

    await ReactTestRenderer.act(() =>
      byLabel(tree, 'Notifications')!.props.onPress(),
    );
    expect(handlers.onPressNotifications).toHaveBeenCalledTimes(1);
    expect(handlers.onPressAvatar).not.toHaveBeenCalled();

    await ReactTestRenderer.act(() =>
      byLabel(tree, 'Your profile')!.props.onPress(),
    );
    expect(handlers.onPressAvatar).toHaveBeenCalledTimes(1);
  });
});
