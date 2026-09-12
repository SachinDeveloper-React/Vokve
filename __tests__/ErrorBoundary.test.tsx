/**
 * The boundary only runs when something has already gone wrong, so the failure
 * mode is silent: a bug in the fallback itself (calling a hook from the class,
 * for instance) turns a recoverable error into a hard crash.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { textOf as collectText } from './helpers/text';
import ErrorBoundary from '../src/components/common/ErrorBoundary';
import { ThemeProvider } from '../src/theme';

let shouldThrow = true;

const Boom = () => {
  if (shouldThrow) {
    throw new Error('exploded during render');
  }
  return <Text>recovered</Text>;
};

const renderBoundary = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </ThemeProvider>,
    );
  });
  return tree;
};

const textContent = (tree: ReactTestRenderer.ReactTestRenderer): string =>
  collectText(tree, Text);

let consoleError: jest.SpyInstance;

beforeEach(() => {
  shouldThrow = true;
  // React logs every caught render error; that noise is expected here.
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

test('renders the themed fallback instead of crashing', async () => {
  const tree = await renderBoundary();

  expect(textContent(tree)).toContain('Something went wrong');
});

test('the fallback reads theme colours without throwing', async () => {
  const tree = await renderBoundary();

  // A hook called from the class component would have thrown before reaching
  // here; this asserts the fallback actually resolved a colour from context.
  const title = tree.root
    .findAllByType(Text)
    .find(node => node.props.children === 'Something went wrong');

  expect(title).toBeDefined();
  expect(title!.props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ color: expect.any(String) }),
    ]),
  );
});

test('shows the error detail in development builds', async () => {
  const tree = await renderBoundary();

  expect(textContent(tree)).toContain('exploded during render');
});

test('retry remounts the subtree once the child stops throwing', async () => {
  const tree = await renderBoundary();

  // Located by props rather than by type: Pressable is a wrapped component,
  // so `findAllByType(Pressable)` does not match the rendered node.
  const retry = tree.root
    .findAll(node => node.props?.accessibilityLabel === 'Try again')
    .find(node => typeof node.props.onPress === 'function');
  expect(retry).toBeDefined();

  shouldThrow = false;
  await ReactTestRenderer.act(() => {
    retry!.props.onPress();
  });

  expect(textContent(tree)).toContain('recovered');
  expect(textContent(tree)).not.toContain('Something went wrong');
});
