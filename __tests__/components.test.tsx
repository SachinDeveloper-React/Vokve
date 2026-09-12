/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf as collectText } from './helpers/text';
import { Avatar } from '../src/components/media/Avatar';
import { Grid } from '../src/components/layout/Grid';
import { HStack } from '../src/components/layout/Stack';
import { Accordion } from '../src/components/disclosure/Accordion';
import { ToastProvider, useToast } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { spacing } from '../src/theme';

const wrap = (node: React.ReactNode) => (
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 400, height: 800 },
      insets: { top: 20, left: 0, right: 0, bottom: 0 },
    }}
  >
    <ThemeProvider>{node}</ThemeProvider>
  </SafeAreaProvider>
);

const render = async (node: React.ReactNode) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(wrap(node));
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

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  collectText(tree, Text);

describe('Grid', () => {
  test('sizes cells to an equal share of the row', async () => {
    const tree = await render(
      <Grid columns={3} gap="md">
        <Text>a</Text>
        <Text>b</Text>
        <Text>c</Text>
      </Grid>,
    );

    const cells = tree.root
      .findAllByType(View)
      .map(n => flatten(n.props.style))
      .filter(s => typeof s.width === 'string');

    expect(cells).toHaveLength(3);
    expect(cells[0].width).toBe(`${100 / 3}%`);
  });

  test('offsets gutters so the row does not overflow', async () => {
    const tree = await render(
      <Grid columns={2} gap="base">
        <Text>a</Text>
        <Text>b</Text>
      </Grid>,
    );

    const styles = tree.root.findAllByType(View).map(n => flatten(n.props.style));
    const container = styles.find(s => s.flexWrap === 'wrap');
    const cell = styles.find(s => typeof s.width === 'string');

    // Half the gap pads each side of a cell; the container pulls that back so
    // two 50% cells still fit exactly one row.
    expect(container?.marginHorizontal).toBe(-spacing.base / 2);
    expect(cell?.paddingHorizontal).toBe(spacing.base / 2);
  });
});

describe('HStack', () => {
  test('resolves gap from the spacing scale', async () => {
    const tree = await render(
      <HStack gap="lg" align="center">
        <Text>a</Text>
      </HStack>,
    );

    const row = tree.root
      .findAllByType(View)
      .map(n => flatten(n.props.style))
      .find(s => s.flexDirection === 'row');

    expect(row?.gap).toBe(spacing.lg);
    expect(row?.alignItems).toBe('center');
  });
});

describe('Avatar', () => {
  test('builds initials from the first and last name', async () => {
    const tree = await render(<Avatar name="Sachin Kumar" />);
    expect(allText(tree)).toContain('SK');
  });

  test('falls back to two letters for a single name', async () => {
    const tree = await render(<Avatar name="vokve" />);
    expect(allText(tree)).toContain('VO');
  });

  test('gives the same name the same colour every time', async () => {
    const colorOf = async (name: string) => {
      const tree = await render(<Avatar name={name} />);
      return tree.root
        .findAllByType(View)
        .map(n => flatten(n.props.style))
        .find(s => typeof s.borderRadius === 'number' && s.backgroundColor)
        ?.backgroundColor;
    };

    expect(await colorOf('Sachin Kumar')).toBe(await colorOf('Sachin Kumar'));
  });
});

describe('Accordion', () => {
  test('opening one section closes the others when exclusive', async () => {
    const tree = await render(
      <Accordion
        sections={[
          { title: 'First', content: <Text>first body</Text> },
          { title: 'Second', content: <Text>second body</Text> },
        ]}
      />,
    );

    const headerFor = (label: string) =>
      tree.root
        .findAll(n => n.props?.accessibilityLabel === label)
        .find(n => typeof n.props.onPress === 'function');

    await ReactTestRenderer.act(() => headerFor('First')!.props.onPress());
    expect(headerFor('First')!.props.accessibilityState.expanded).toBe(true);

    await ReactTestRenderer.act(() => headerFor('Second')!.props.onPress());
    expect(headerFor('First')!.props.accessibilityState.expanded).toBe(false);
    expect(headerFor('Second')!.props.accessibilityState.expanded).toBe(true);
  });
});

describe('Toast', () => {
  const Trigger = ({ durationMs }: { durationMs?: number }) => {
    const { show } = useToast();
    return (
      <View
        accessibilityLabel="trigger"
        onTouchEnd={() => show({ title: 'Set saved', durationMs })}
      />
    );
  };

  const showToast = async (durationMs?: number) => {
    const tree = await render(
      <ToastProvider>
        <Trigger durationMs={durationMs} />
      </ToastProvider>,
    );
    const trigger = tree.root.find(
      n => n.props?.accessibilityLabel === 'trigger',
    );
    await ReactTestRenderer.act(() => trigger.props.onTouchEnd());
    return tree;
  };

  test('shows the toast that was raised', async () => {
    const tree = await showToast(0);
    expect(allText(tree)).toContain('Set saved');
  });

  test('dismisses itself once its duration elapses', async () => {
    jest.useFakeTimers();
    try {
      const tree = await showToast(1000);
      expect(allText(tree)).toContain('Set saved');

      await ReactTestRenderer.act(() => {
        jest.advanceTimersByTime(1100);
      });

      expect(allText(tree)).not.toContain('Set saved');
    } finally {
      jest.useRealTimers();
    }
  });

  test('a duration of 0 keeps the toast until it is dismissed', async () => {
    jest.useFakeTimers();
    try {
      const tree = await showToast(0);
      await ReactTestRenderer.act(() => {
        jest.advanceTimersByTime(10_000);
      });
      expect(allText(tree)).toContain('Set saved');
    } finally {
      jest.useRealTimers();
    }
  });

  test('useToast outside the provider is a clear error', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let message = '';
    try {
      await render(<Trigger />);
    } catch (error) {
      message = (error as Error).message;
    }
    spy.mockRestore();
    expect(message).toBe('useToast must be used within a ToastProvider');
  });
});
