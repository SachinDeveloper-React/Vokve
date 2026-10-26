/**
 * The analytics chart's axis and the breakdown behind "View Insights".
 *
 * The axis is the part that kept going wrong: labels used to be handed to the
 * card beside the series, so a period of a different length drew its ticks
 * against the wrong bars — or, for a week, drew two of the seven. The checks
 * here are that a tick exists for every bar it claims to name, that the cells
 * are equal so the nth tick lands over the nth bar, and that the breakdown
 * states the server's own totals rather than adding anything up again.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import {
  StepsOverviewCard,
  type OverviewPoint,
} from '../src/components/analytics/StepsOverviewCard';
import {
  StepsInsightsSheet,
  goalLine,
  insightRows,
} from '../src/components/analytics/StepsInsightsSheet';
import { ThemeProvider } from '../src/theme';
import type { ActivityRange } from '../src/types/models';

const metrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
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

/**
 * The axis ticks, in order. They are the only text in the card laid out as a
 * cell of its own, which is exactly what makes them line up with the bars.
 */
const ticksOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(RNText)
    .filter(node => flatten(node.props.style).flex === 1)
    .map(node => String(node.props.children));

const WEEK: OverviewPoint[] = [
  ['Mon', 4200],
  ['Tue', 7856],
  ['Wed', 10245],
  ['Thu', 8650],
  ['Fri', 6321],
  ['Sat', 9125],
  ['Sun', 6245],
].map(([label, steps]) => ({ label: label as string, steps: steps as number }));

const HOURS: OverviewPoint[] = Array.from({ length: 24 }, (_, hour) => ({
  label: `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`,
  steps: hour === 9 ? 6245 : 0,
}));

const MONTHS: OverviewPoint[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
].map((label, index) => ({ label, steps: (index + 1) * 1000 }));

const totals = (
  over: Partial<ActivityRange['totals']> = {},
): ActivityRange['totals'] => ({
  steps: 10_000,
  verifiedSteps: 8_000,
  distanceKm: 10,
  caloriesBurned: 500,
  activeMinutes: 100,
  activeDays: 4,
  ...over,
});

describe('StepsOverviewCard axis', () => {
  test('a week draws a tick for every day, not just its ends', async () => {
    const tree = await render(
      <StepsOverviewCard
        points={WEEK}
        caption="This week, day by day"
        onPressInsights={() => {}}
      />,
    );

    expect(ticksOf(tree)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
  });

  test('a month of weekly bars names each one in its own cell', async () => {
    const tree = await render(
      <StepsOverviewCard
        points={[1, 2, 3, 4, 5].map(week => ({
          label: `W${week}`,
          steps: week * 1000,
        }))}
        caption="This month, week by week"
        onPressInsights={() => {}}
      />,
    );

    expect(ticksOf(tree)).toEqual(['W1', 'W2', 'W3', 'W4', 'W5']);
  });

  test('a year draws all twelve months in step with its bars', async () => {
    const tree = await render(
      <StepsOverviewCard
        points={MONTHS}
        caption="This year, month by month"
        onPressInsights={() => {}}
      />,
    );

    expect(ticksOf(tree)).toEqual(MONTHS.map(point => point.label));
  });

  test('a dense series labels every nth bar, starting at the first', async () => {
    const tree = await render(
      <StepsOverviewCard
        points={HOURS}
        caption="Today, hour by hour"
        labelEvery={4}
        onPressInsights={() => {}}
      />,
    );

    expect(ticksOf(tree)).toEqual([
      '12 AM',
      '4 AM',
      '8 AM',
      '12 PM',
      '4 PM',
      '8 PM',
    ]);
  });

  test('the ticks follow the series: a shorter period draws fewer', async () => {
    const tree = await render(
      <StepsOverviewCard
        points={WEEK.slice(0, 3)}
        caption="Week of 1 June 2026, day by day"
        onPressInsights={() => {}}
      />,
    );

    expect(ticksOf(tree)).toEqual(['Mon', 'Tue', 'Wed']);
  });

  test('a period that has not loaded draws no axis at all', async () => {
    const tree = await render(
      <StepsOverviewCard
        points={[]}
        caption="This week, day by day"
        onPressInsights={() => {}}
      />,
    );

    expect(ticksOf(tree)).toEqual([]);
  });
});

describe('insightRows', () => {
  test('the period’s figures are the verified share of it', () => {
    const rows = insightRows('week', WEEK, totals());

    expect(rows).toEqual([
      { label: 'Total steps', value: '8,000' },
      // 8,000 over the four days that counted anything, not over seven.
      { label: 'Daily average', value: '2,000' },
      { label: 'Active days', value: '4' },
      { label: 'Busiest day', value: 'Wed · 10,245' },
      // Four fifths of the steps were verified, so four fifths of the
      // kilometres, the calories and the minutes are too.
      { label: 'Distance', value: '8.0 km' },
      { label: 'Calories burned', value: '400' },
      { label: 'Active time', value: '1h 20m' },
    ]);
  });

  test('a day is read by the hour, with no daily average to give', () => {
    const rows = insightRows('day', HOURS, totals({ activeDays: 1 }));

    expect(rows.map(row => row.label)).toEqual([
      'Total steps',
      'Busiest hour',
      'Distance',
      'Calories burned',
      'Active time',
    ]);
    expect(rows[1].value).toBe('9 AM · 6,245');
  });

  test('a month and a year each name their own busiest bucket', () => {
    expect(
      insightRows(
        'month',
        [
          { label: 'W1', steps: 1000 },
          { label: 'W2', steps: 9000 },
        ],
        totals(),
      ).find(row => row.label === 'Busiest week')?.value,
    ).toBe('W2 · 9,000');

    expect(
      insightRows('year', MONTHS, totals()).find(
        row => row.label === 'Busiest month',
      )?.value,
    ).toBe('Dec · 12,000');
  });

  test('a period with nothing in it reports dashes, not zeros it invented', () => {
    const rows = insightRows(
      'week',
      WEEK.map(point => ({ ...point, steps: 0 })),
      totals({ steps: 0, verifiedSteps: 0, activeDays: 0 }),
    );

    expect(rows.find(row => row.label === 'Daily average')?.value).toBe('—');
    expect(rows.find(row => row.label === 'Busiest day')?.value).toBe('—');
  });
});

describe('goalLine', () => {
  test('a day is set against the goal itself', () => {
    expect(goalLine('day', totals(), 10_000)).toBe(
      'That total is 80% of the 10,000 step daily goal.',
    );
  });

  test('a longer period is set against it by the day', () => {
    expect(goalLine('week', totals(), 10_000)).toBe(
      'Your daily average is 20% of the 10,000 step goal.',
    );
  });

  test('an empty period says so rather than reading 0%', () => {
    expect(
      goalLine('week', totals({ steps: 0, verifiedSteps: 0 }), 10_000),
    ).toBe('No steps counted in this period yet.');
  });
});

describe('StepsInsightsSheet', () => {
  test('states the period, its figures and where the goal stands', async () => {
    const tree = await render(
      <StepsInsightsSheet
        visible
        onClose={() => {}}
        range="week"
        caption="This week, day by day"
        points={WEEK}
        totals={totals()}
        goal={10_000}
      />,
    );
    const text = textOf(tree, RNText);

    expect(text).toContain('Steps Insights');
    expect(text).toContain('This week, day by day');
    expect(text).toContain('Total steps');
    expect(text).toContain('8,000');
    expect(text).toContain('Busiest day');
    expect(text).toContain('Wed · 10,245');
    expect(text).toContain('Your daily average is 20% of the 10,000 step goal');
  });

  test('says the figures are still coming rather than showing none', async () => {
    const tree = await render(
      <StepsInsightsSheet
        visible
        onClose={() => {}}
        range="week"
        caption="This week, day by day"
        points={[]}
        totals={null}
        goal={10_000}
      />,
    );
    const text = textOf(tree, RNText);

    expect(text).toContain('have not arrived yet');
    expect(text).not.toContain('Total steps');
  });
});
