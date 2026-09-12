/**
 * The app's `Pressable` must never hand React Native the `({ pressed }) => …`
 * callback form of `style`.
 *
 * Reanimated flattens whatever `style` it is given into an array before passing
 * it on, so a callback arrives at `Pressable` as `[fn]`: no longer a function,
 * so RN never invokes it, and it flattens away to nothing. Everything the
 * control needed from that style — its own layout included — disappears with
 * it, and nothing errors. A checkbox that lost `flexDirection: 'row'` this way
 * simply rendered its label under the box instead of beside it.
 *
 * @format
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Checkbox } from '../src/components/form/Checkbox';
import { Pressable } from '../src/components/form/Pressable';
import { ThemeProvider } from '../src/theme';

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

/** Every style that actually reaches a host view, already flattened. */
const hostStyles = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(View)
    .map(node => StyleSheet.flatten(node.props.style))
    .filter(Boolean);

const functionStyles = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll(node => typeof node.props?.style === 'function');

describe('Pressable', () => {
  test.each(['opacity', 'scale', 'highlight', 'none'] as const)(
    'passes %s feedback down as a style array, never a callback',
    async feedback => {
      const tree = await render(
        <Pressable feedback={feedback} onPress={() => {}} style={PROBE}>
          <Text>Tap</Text>
        </Pressable>,
      );

      expect(functionStyles(tree)).toHaveLength(0);
      // The caller's own style has to survive as far as a host view.
      expect(hostStyles(tree)).toContainEqual(
        expect.objectContaining(PROBE),
      );
    },
  );

  test('keeps a disabled control dimmed rather than letting the resting style win', async () => {
    const tree = await render(
      <Pressable disabled onPress={() => {}} style={PROBE}>
        <Text>Tap</Text>
      </Pressable>,
    );

    expect(hostStyles(tree)).toContainEqual(
      expect.objectContaining({ opacity: 0.45 }),
    );
  });
});

describe('Checkbox layout', () => {
  test('lays its label out beside the box, not under it', async () => {
    const tree = await render(
      <Checkbox checked={false} onChange={() => {}} label="Accept" />,
    );

    expect(functionStyles(tree)).toHaveLength(0);
    expect(hostStyles(tree)).toContainEqual(
      expect.objectContaining({ flexDirection: 'row' }),
    );
  });
});

/** A property no theme sets, so finding it proves the caller's style survived. */
const PROBE = { flexDirection: 'row' as const, marginTop: 7 };
