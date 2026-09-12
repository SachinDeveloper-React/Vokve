/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf as collectText } from './helpers/text';
import { StepGoalCard } from '../src/components/fitness/StepGoalCard';
import { WeeklyStepsChart } from '../src/components/fitness/WeeklyStepsChart';
import { MetricTile } from '../src/components/fitness/MetricTile';
import { WeeklyTrainingCard } from '../src/components/fitness/WeeklyTrainingCard';
import { useWindowDimensions } from 'react-native';
import { ThemeProvider, lightColors } from '../src/theme';
import { MapPin } from 'lucide-react-native';

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

describe('StepGoalCard', () => {
  test('shows progress and what is still left', async () => {
    const tree = await render(<StepGoalCard steps={6245} goal={10000} />);
    const text = allText(tree);

    expect(text).toContain('6,245');
    expect(text).toContain('/ 10,000');
    expect(text).toContain('62%');
    expect(text).toContain('3,755');
    expect(text).toContain('steps left');
  });

  test('switches to a completed state instead of showing a negative remainder', async () => {
    const tree = await render(<StepGoalCard steps={12000} goal={10000} />);
    const text = allText(tree);

    expect(text).toContain('120%');
    expect(text).toContain('Goal reached');
    expect(text).not.toContain('steps left');
  });

  test('survives a zero goal rather than dividing by it', async () => {
    const tree = await render(<StepGoalCard steps={500} goal={0} />);
    // Nothing should render NaN or Infinity.
    expect(allText(tree)).not.toMatch(/NaN|Infinity/);
  });

  test('offers the edit action only when a handler is given', async () => {
    const withHandler = await render(
      <StepGoalCard steps={1} goal={10} onEditGoal={() => {}} />,
    );
    expect(allText(withHandler)).toContain('Edit Goal');

    const without = await render(<StepGoalCard steps={1} goal={10} />);
    expect(allText(without)).not.toContain('Edit Goal');
  });
});

describe('WeeklyStepsChart', () => {
  const week = [
    { day: 'Mon', steps: 4200 },
    { day: 'Tue', steps: 7856 },
    { day: 'Wed', steps: 10245 },
    { day: 'Thu', steps: 8650 },
    { day: 'Fri', steps: 6321 },
    { day: 'Sat', steps: 9125 },
    { day: 'Sun', steps: 6245 },
  ];

  test('labels every day with its value and percentage', async () => {
    const tree = await render(<WeeklyStepsChart data={week} goal={10000} />);
    const text = allText(tree);

    expect(text).toContain('10,245');
    expect(text).toContain('102%');
    expect(text).toContain('Wed');
  });

  test('gives each bar a spoken description, since a bar has no text of its own', async () => {
    const tree = await render(<WeeklyStepsChart data={week} goal={10000} />);

    const labels = tree.root
      .findAll(n => typeof n.props?.accessibilityLabel === 'string')
      .map(n => n.props.accessibilityLabel as string);

    expect(labels).toContain('Wed, 10,245 steps, 102 percent of goal');
    expect(labels).toContain('Mon, 4,200 steps, 42 percent of goal');
  });

  test('draws every day in one tint, since the percentage already says who met the goal', async () => {
    const tree = await render(<WeeklyStepsChart data={week} goal={10000} />);

    const bars = tree.root
      .findAllByType(View)
      .map(n => flatten(n.props.style))
      .filter(s => typeof s.height === 'number' && s.borderRadius === 999);

    expect(bars).toHaveLength(7);
    // A shade cannot say 102% against 91%; the label under the bar can.
    expect(new Set(bars.map(b => b.backgroundColor)).size).toBe(1);
  });

  test('bar heights are proportional to their values', async () => {
    const tree = await render(<WeeklyStepsChart data={week} goal={10000} />);

    const heights = tree.root
      .findAllByType(View)
      .map(n => flatten(n.props.style))
      .filter(s => typeof s.height === 'number' && s.borderRadius === 999)
      .map(s => s.height as number);

    // Mon 4,200 against Wed 10,245 — roughly the same ratio as the values.
    expect(heights[0] / heights[2]).toBeCloseTo(4200 / 10245, 1);
  });

  test('handles a week with no steps without collapsing', async () => {
    const empty = week.map(d => ({ ...d, steps: 0 }));
    const tree = await render(<WeeklyStepsChart data={empty} goal={10000} />);

    expect(allText(tree)).not.toMatch(/NaN|Infinity/);
    expect(allText(tree)).toContain('0%');
  });
});

describe('MetricTile', () => {
  test('is only a button when it has somewhere to go', async () => {
    const onPress = jest.fn();
    const tappable = await render(
      <MetricTile
        icon={MapPin}
        label="Analysis"
        value="View"
        tint={lightColors.avatarCyan}
        onPress={onPress}
      />,
    );

    const button = tappable.root.find(
      n => n.props?.accessibilityLabel === 'Analysis, View',
    );
    await ReactTestRenderer.act(() => button.props.onPress());
    expect(onPress).toHaveBeenCalled();

    const plain = await render(
      <MetricTile
        icon={MapPin}
        label="Distance"
        value="4.2 km"
        tint={lightColors.avatarPrimary}
      />,
    );
    expect(
      plain.root.findAll(n => n.props?.accessibilityRole === 'button'),
    ).toHaveLength(0);
  });
});

describe('WeeklyTrainingCard', () => {
  const figures = [
    { label: 'Volume', value: '4.5k', unit: 'kg' },
    { label: 'Streak', value: '6', unit: 'days' },
    { label: 'Body weight', value: '72 kg' },
  ];

  test('summarises the week without a second progress ring', async () => {
    const tree = await render(
      <WeeklyTrainingCard completed={3} goal={4} figures={figures} />,
    );
    const text = allText(tree);

    expect(text).toContain('This week');
    expect(text).toContain('3 of 4 workouts');
    expect(text).toContain('4.5k');
    expect(text).toContain('Streak');
  });

  test('does not divide by a zero goal', async () => {
    const tree = await render(
      <WeeklyTrainingCard completed={2} goal={0} figures={figures} />,
    );
    expect(allText(tree)).not.toMatch(/NaN|Infinity/);
  });

  test('renders a figure with no unit', async () => {
    const tree = await render(
      <WeeklyTrainingCard completed={1} goal={4} figures={[figures[2]]} />,
    );
    expect(allText(tree)).toContain('72 kg');
  });
});

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

const mockedDimensions = useWindowDimensions as jest.MockedFunction<
  typeof useWindowDimensions
>;

const setWindow = (w: number) =>
  mockedDimensions.mockReturnValue({
    width: w,
    height: 800,
    scale: 2,
    fontScale: 1,
  });

beforeEach(() => setWindow(390));

describe('StepGoalCard sizing', () => {
  const ringOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
    tree.root
      .findAll(n => typeof n.props?.r === 'number')
      .map(n => n.props.r as number)[0];

  test('the ring shrinks on a narrow phone so the three columns still fit', async () => {
    setWindow(320);
    const small = ringOf(await render(<StepGoalCard steps={6245} goal={10000} />));

    setWindow(430);
    const large = ringOf(await render(<StepGoalCard steps={6245} goal={10000} />));

    expect(small).toBeLessThan(large);
  });

  test('the step count is fitted to the arc, not left to overflow it', async () => {
    setWindow(320);
    // Six digits is where a fixed font size grows into the stroke.
    const tree = await render(<StepGoalCard steps={106245} goal={200000} />);

    const number = tree.root
      .findAllByType(Text)
      .find(n => n.props.children === '106,245');

    expect(number?.props.adjustsFontSizeToFit).toBe(true);
    expect(number?.props.numberOfLines).toBe(1);
    expect(flatten(number?.props.style).maxWidth).toBeGreaterThan(0);
  });
});

describe('StepGoalCard ring', () => {
  test('the arc uses the brand accent, not the default primary', async () => {
    const tree = await render(<StepGoalCard steps={6245} goal={10000} />);

    // The ring is the card's headline; it has to carry the brand orange the
    // percentage beside it uses, or the two read as unrelated figures.
    const strokes = tree.root
      .findAll(n => typeof n.props?.stroke === 'string')
      .map(n => n.props.stroke as string);

    expect(strokes).toContain(lightColors.brandAccent);
    expect(strokes).not.toContain(lightColors.primary);
  });
});

describe('card chrome', () => {
  test('an elevated card does not also draw a border', async () => {
    // A shadow and an outline together are two edges on one card, which is
    // what makes a surface look unfinished.
    const tree = await render(<StepGoalCard steps={1} goal={10} />);

    const surfaces = tree.root
      .findAllByType(View)
      .map(n => flatten(n.props.style))
      .filter(s => s.shadowOpacity !== undefined || s.elevation !== undefined);

    expect(surfaces.length).toBeGreaterThan(0);
    surfaces.forEach(s => expect(s.borderWidth).toBeUndefined());
  });
});
