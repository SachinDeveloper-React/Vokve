/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Grid } from '../src/components/layout/Grid';
import { Screen } from '../src/components/ui/Screen';
import { useResponsive } from '../src/hooks/useResponsive';
import { ThemeProvider } from '../src/theme';
import { moderateScale, scale, scaleFactor } from '../src/theme/responsive';
import { spacing, typography, HIT_SLOP_MIN } from '../src/theme';

const mockedDimensions = useWindowDimensions as jest.MockedFunction<
  typeof useWindowDimensions
>;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

const setWindow = (width: number, height: number) => {
  mockedDimensions.mockReturnValue({ width, height, scale: 2, fontScale: 1 });
};

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

const flatten = (style: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const visit = (s: unknown) => {
    if (Array.isArray(s)) return s.forEach(visit);
    if (s && typeof s === 'object') Object.assign(out, s);
  };
  visit(style);
  return out;
};

beforeEach(() => {
  setWindow(375, 812);
});

describe('scaling', () => {
  test('stays inside the clamp on any device', () => {
    expect(scaleFactor).toBeGreaterThanOrEqual(0.85);
    expect(scaleFactor).toBeLessThanOrEqual(1.3);
  });

  test('moderateScale moves less than a proportional scale', () => {
    const size = 100;
    const proportional = Math.abs(scale(size) - size);
    const moderated = Math.abs(moderateScale(size) - size);

    expect(moderated).toBeLessThanOrEqual(proportional);
  });

  test('a size of zero stays zero', () => {
    expect(moderateScale(0)).toBe(0);
    expect(spacing.none).toBe(0);
  });

  test('the spacing scale keeps its order after scaling', () => {
    expect(spacing.xs).toBeLessThan(spacing.sm);
    expect(spacing.sm).toBeLessThan(spacing.base);
    expect(spacing.base).toBeLessThan(spacing.xl);
    expect(spacing.xl).toBeLessThan(spacing.huge);
  });

  test('type sizes keep their hierarchy after scaling', () => {
    expect(typography.caption.fontSize).toBeLessThan(typography.body.fontSize);
    expect(typography.body.fontSize).toBeLessThan(typography.h1.fontSize);
    expect(typography.h1.fontSize).toBeLessThan(typography.display.fontSize);
  });

  test('the touch-target floor is never scaled below 44pt', () => {
    // A fingertip is the same size on every device, so this must not scale.
    expect(HIT_SLOP_MIN).toBe(44);
  });
});

describe('useResponsive', () => {
  const Probe = () => {
    const r = useResponsive();
    return <Text>{`${r.breakpoint}|${r.isLandscape}|${r.select({ compact: 1, expanded: 4 })}`}</Text>;
  };

  const readProbe = async () => {
    const tree = await render(<Probe />);
    return tree.root.findByType(Text).props.children as string;
  };

  test('a phone in portrait is compact', async () => {
    setWindow(375, 812);
    expect(await readProbe()).toBe('compact|false|1');
  });

  test('a phone in landscape crosses into medium', async () => {
    setWindow(812, 375);
    expect(await readProbe()).toBe('medium|true|1');
  });

  test('a tablet is expanded and picks the expanded value', async () => {
    setWindow(1024, 1366);
    expect(await readProbe()).toBe('expanded|false|4');
  });

  test('select falls back to the widest breakpoint defined below it', async () => {
    // 'medium' is undefined, so it must fall back to 'compact', not to nothing.
    setWindow(700, 400);
    expect(await readProbe()).toBe('medium|true|1');
  });
});

describe('Grid columns', () => {
  test('accepts a fixed column count', async () => {
    const tree = await render(
      <Grid columns={3}>
        <Text>a</Text>
      </Grid>,
    );
    const cell = tree.root
      .findAllByType(View)
      .map(n => flatten(n.props.style))
      .find(s => typeof s.width === 'string');

    expect(cell?.width).toBe(`${100 / 3}%`);
  });

  test('widens on a tablet when given a responsive map', async () => {
    setWindow(1024, 1366);
    const tree = await render(
      <Grid columns={{ compact: 2, expanded: 4 }}>
        <Text>a</Text>
      </Grid>,
    );
    const cell = tree.root
      .findAllByType(View)
      .map(n => flatten(n.props.style))
      .find(s => typeof s.width === 'string');

    expect(cell?.width).toBe('25%');
  });
});

describe('Screen width cap', () => {
  test('runs full width on a phone', async () => {
    setWindow(375, 812);
    const tree = await render(
      <Screen>
        <Text>body</Text>
      </Screen>,
    );
    const content = tree.root
      .findAllByType(View)
      .map(n => flatten(n.props.style))
      .find(s => s.flex === 1 && s.width === '100%');

    expect(content?.maxWidth).toBeUndefined();
  });

  test('caps and centres the column on a wide screen', async () => {
    setWindow(1024, 1366);
    const tree = await render(
      <Screen>
        <Text>body</Text>
      </Screen>,
    );
    const content = tree.root
      .findAllByType(View)
      .map(n => flatten(n.props.style))
      .find(s => s.maxWidth === 640);

    expect(content?.alignSelf).toBe('center');
  });
});
