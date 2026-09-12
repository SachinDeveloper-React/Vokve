/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf as collectText } from './helpers/text';
import { HydrationCard } from '../src/components/fitness/HydrationCard';
import { MotivationCard } from '../src/components/home/MotivationCard';
import { MOTIVATION_EMOJIS } from '../src/components/home/MotivationArt';
import { QuickActionsRow } from '../src/components/home/QuickActionsRow';
import { useHydrationStore } from '../src/stores/hydrationStore';
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

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  collectText(tree, Text);

const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');

describe('hydration store', () => {
  beforeEach(() => {
    useHydrationStore.getState().reset();
  });

  test('accumulates what was logged today', () => {
    const { add } = useHydrationStore.getState();
    add(200);
    add(500);

    expect(useHydrationStore.getState().todayMl()).toBe(700);
  });

  test("yesterday's total does not carry into today", () => {
    useHydrationStore.setState({ date: '2020-01-01', consumedMl: 2000 });

    // The stored day has passed, so the count reads as zero rather than
    // showing the morning as already complete.
    expect(useHydrationStore.getState().todayMl()).toBe(0);
  });

  test('logging after a rollover starts from zero, not from the old total', () => {
    useHydrationStore.setState({ date: '2020-01-01', consumedMl: 2000 });
    useHydrationStore.getState().add(250);

    expect(useHydrationStore.getState().todayMl()).toBe(250);
  });

  test('adding logs a row as well as raising the total', () => {
    useHydrationStore.getState().add(250);
    useHydrationStore.getState().add(500);

    const { consumedMl, entries } = useHydrationStore.getState();
    expect(consumedMl).toBe(750);
    // Newest first, so the log reads as a day being added to from the top.
    expect(entries.map(entry => entry.ml)).toEqual([500, 250]);
  });

  test('removing a row takes exactly its millilitres off the total', () => {
    useHydrationStore.getState().add(250);
    useHydrationStore.getState().add(500);
    const [newest] = useHydrationStore.getState().entries;

    useHydrationStore.getState().remove(newest.id);

    expect(useHydrationStore.getState().consumedMl).toBe(250);
    expect(useHydrationStore.getState().entries).toHaveLength(1);
  });

  test('removing a row that has already gone changes nothing', () => {
    useHydrationStore.getState().add(250);

    useHydrationStore.getState().remove('not-a-row');

    expect(useHydrationStore.getState().consumedMl).toBe(250);
    expect(useHydrationStore.getState().entries).toHaveLength(1);
  });

  test('undo drops the newest drink of that size from the log', () => {
    useHydrationStore.getState().add(250);
    useHydrationStore.getState().add(500);

    useHydrationStore.getState().undo(500);

    expect(useHydrationStore.getState().consumedMl).toBe(250);
    expect(
      useHydrationStore.getState().entries.map(entry => entry.ml),
    ).toEqual([250]);
  });

  test('undo never takes the total below zero', () => {
    useHydrationStore.getState().add(200);
    useHydrationStore.getState().undo(500);

    expect(useHydrationStore.getState().todayMl()).toBe(0);
  });
});

describe('HydrationCard', () => {
  test('shows the amount, the goal and the percentage', async () => {
    const tree = await render(
      <HydrationCard consumedMl={1600} goalMl={2500} onAdd={() => {}} />,
    );
    const text = allText(tree);

    expect(text).toContain('1.6');
    expect(text).toContain('/ 2.5 L');
    expect(text).toContain('64%');
  });

  test('the glasses are a second reading of the same number', async () => {
    const tree = await render(
      <HydrationCard consumedMl={1250} goalMl={2500} onAdd={() => {}} />,
    );

    const label = tree.root
      .findAll(n => typeof n.props?.accessibilityLabel === 'string')
      .map(n => n.props.accessibilityLabel as string)
      .find(l => l.includes('glasses'));

    // Half the goal, so half the glasses.
    expect(label).toBe('5 of 10 glasses');
  });

  test('each quick-add reports its own amount', async () => {
    const onAdd = jest.fn();
    const tree = await render(
      <HydrationCard consumedMl={0} goalMl={2500} onAdd={onAdd} />,
    );

    await ReactTestRenderer.act(() =>
      byLabel(tree, 'Add 200 millilitres')!.props.onPress(),
    );
    expect(onAdd).toHaveBeenCalledWith(200);

    await ReactTestRenderer.act(() =>
      byLabel(tree, 'Add 500 millilitres')!.props.onPress(),
    );
    expect(onAdd).toHaveBeenCalledWith(500);
  });

  test('a zero goal does not produce NaN or an endless row of glasses', async () => {
    const tree = await render(
      <HydrationCard consumedMl={500} goalMl={0} onAdd={() => {}} />,
    );

    expect(allText(tree)).not.toMatch(/NaN|Infinity/);
  });

  test('over-drinking caps the glasses instead of overflowing the row', async () => {
    const tree = await render(
      <HydrationCard consumedMl={9000} goalMl={2500} onAdd={() => {}} />,
    );

    const label = tree.root
      .findAll(n => typeof n.props?.accessibilityLabel === 'string')
      .map(n => n.props.accessibilityLabel as string)
      .find(l => l.includes('glasses'));

    expect(label).toBe('10 of 10 glasses');
  });
});

describe('QuickActionsRow', () => {
  const handlers = {
    onPressChallenges: jest.fn(),
    onPressNutrition: jest.fn(),
    onPressHealth: jest.fn(),
    onPressStreaks: jest.fn(),
  };

  test('the streak card reports the current run', async () => {
    const tree = await render(
      <QuickActionsRow streakDays={7} {...handlers} />,
    );
    // Title case, as the design sets it: the streak card's value is the one
    // label in the row that is not upper-cased.
    expect(allText(tree)).toContain('7 Days');
  });

  test('a one-day streak is singular', async () => {
    const tree = await render(
      <QuickActionsRow streakDays={1} {...handlers} />,
    );
    expect(allText(tree)).toContain('1 Day');
    expect(allText(tree)).not.toContain('1 Days');
  });

  test('each shortcut routes to its own handler', async () => {
    const tree = await render(
      <QuickActionsRow streakDays={3} {...handlers} />,
    );

    await ReactTestRenderer.act(() =>
      byLabel(tree, 'Health check up')!.props.onPress(),
    );

    expect(handlers.onPressHealth).toHaveBeenCalledTimes(1);
    expect(handlers.onPressChallenges).not.toHaveBeenCalled();
  });
});

describe('MotivationCard', () => {
  test('renders the quote', async () => {
    const tree = await render(<MotivationCard quote="Small steps every day." />);
    expect(allText(tree)).toContain('Small steps every day.');
  });

  test('is only tappable when it has a destination', async () => {
    const plain = await render(<MotivationCard quote="Keep going." />);
    expect(
      plain.root.findAll(n => n.props?.accessibilityRole === 'button'),
    ).toHaveLength(0);

    const onPress = jest.fn();
    const tappable = await render(
      <MotivationCard quote="Keep going." onPress={onPress} />,
    );
    await ReactTestRenderer.act(() =>
      byLabel(tappable, "Today's motivation: Keep going.")!.props.onPress(),
    );
    expect(onPress).toHaveBeenCalled();
  });

  test('closes with the emoji trio, hidden from screen readers', async () => {
    const tree = await render(<MotivationCard quote="Keep going." />);
    const text = allText(tree);

    for (const emoji of MOTIVATION_EMOJIS) {
      expect(text).toContain(emoji);
    }

    expect(
      tree.root.findAll(
        n =>
          typeof n.type === 'string' &&
          typeof n.props?.children === 'string' &&
          MOTIVATION_EMOJIS.includes(
            n.props.children as (typeof MOTIVATION_EMOJIS)[number],
          ) &&
          n.props.accessibilityElementsHidden !== true,
      ),
    ).toHaveLength(0);
  });

  test('a caller can swap in its own artwork', async () => {
    const tree = await render(
      <MotivationCard quote="Keep going." illustration={<Text>ART</Text>} />,
    );
    const text = allText(tree);

    expect(text).toContain('ART');
    expect(text).not.toContain(MOTIVATION_EMOJIS[0]);
  });
});
