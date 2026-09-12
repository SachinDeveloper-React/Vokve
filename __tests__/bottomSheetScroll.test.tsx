/**
 * A sheet and a list inside it both want a downward swipe, and the sheet sits
 * above the list in the tree — so without arbitration the sheet wins every
 * time: the list scrolls down but never back up, because each upward drag
 * starts closing the sheet instead.
 *
 * @format
 */

import React from 'react';
import { ScrollView, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  BottomSheet,
  BottomSheetScrollView,
  shouldSheetTakeDrag,
} from '../src/components/disclosure/BottomSheet';
import { DateField } from '../src/components/form/DateField';
import { FeetInchesField } from '../src/components/form/FeetInchesField';
import { PhoneInput } from '../src/components/form/PhoneInput';
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

const pressableFor = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) =>
  tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function')!;

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  await ReactTestRenderer.act(async () => {
    await pressableFor(tree, label).props.onPress();
  });
};

describe('shouldSheetTakeDrag', () => {
  const base = { dismissible: true, atTop: true, dx: 0, dy: 30 };

  test('takes a downward drag when nothing below can scroll up', () => {
    expect(shouldSheetTakeDrag(base)).toBe(true);
  });

  test('leaves the drag to a list that still has room to scroll up', () => {
    expect(shouldSheetTakeDrag({ ...base, atTop: false })).toBe(false);
  });

  test('ignores upward drags, which belong to the list', () => {
    expect(shouldSheetTakeDrag({ ...base, dy: -30 })).toBe(false);
  });

  test('ignores a mostly horizontal swipe', () => {
    expect(shouldSheetTakeDrag({ ...base, dx: 60, dy: 20 })).toBe(false);
  });

  test('ignores a touch that has barely moved', () => {
    expect(shouldSheetTakeDrag({ ...base, dy: 3 })).toBe(false);
  });

  test('never takes the drag when the sheet cannot be dismissed', () => {
    expect(shouldSheetTakeDrag({ ...base, dismissible: false })).toBe(false);
  });
});

describe('BottomSheetScrollView', () => {
  test('still calls the handlers its caller passed', async () => {
    const onScroll = jest.fn();
    const onTouchStart = jest.fn();

    const tree = await render(
      <BottomSheet visible onClose={() => {}} title="Sheet">
        <BottomSheetScrollView onScroll={onScroll} onTouchStart={onTouchStart}>
          <Text>Row</Text>
        </BottomSheetScrollView>
      </BottomSheet>,
    );

    const list = tree.root.findByType(ScrollView);
    await ReactTestRenderer.act(() => {
      list.props.onScroll({ nativeEvent: { contentOffset: { y: 40 } } });
      list.props.onTouchStart({});
    });

    expect(onScroll).toHaveBeenCalled();
    expect(onTouchStart).toHaveBeenCalled();
  });
});

describe('the sheets that hold lists', () => {
  test("the country picker's list arbitrates with the sheet", async () => {
    const tree = await render(
      <PhoneInput
        value={{ country: 'IN', number: '' }}
        onChange={() => {}}
        label="Phone"
      />,
    );

    await press(tree, 'Country dial code');

    // A bare ScrollView here is exactly the bug: it would lose every
    // downward swipe to the sheet.
    expect(tree.root.findAllByType(BottomSheetScrollView)).toHaveLength(1);
  });

  test("the height picker's two columns arbitrate for themselves", async () => {
    const tree = await render(
      <FeetInchesField value={null} onChange={() => {}} label="Height" />,
    );

    await press(tree, 'Height');

    expect(tree.root.findAllByType(BottomSheetScrollView)).toHaveLength(2);
  });

  test("each of the date picker's three columns arbitrates for itself", async () => {
    const tree = await render(
      <DateField value={null} onChange={() => {}} label="Date of Birth" />,
    );

    await press(tree, 'Date of Birth');

    expect(tree.root.findAllByType(BottomSheetScrollView)).toHaveLength(3);
  });
});
