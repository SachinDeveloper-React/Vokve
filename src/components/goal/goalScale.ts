import type { StepGoal } from '../../types/models';

export type GoalRange = Pick<StepGoal, 'min' | 'max' | 'increment'>;

/**
 * The range until the server has said (⚙ `activity.goal`, D-55). Only the
 * screen's fallback for a first open with no connection: the server checks
 * the range again on save.
 */
export const GOAL_RANGE_FALLBACK: GoalRange = {
  min: 3000,
  max: 20_000,
  increment: 500,
};

/** The slider's marks, as the design spaces them. */
const LADDER = [3000, 5000, 7000, 10_000, 15_000, 20_000];

/**
 * The marks under the slider: the range's ends and the ladder's steps
 * between them. Evenly spaced on the track, not by value — the low end,
 * where most goals are, gets the room, and 20,000 does not squeeze 5,000
 * and 7,000 into the first tenth of the track.
 */
export function goalStops({ min, max }: GoalRange): number[] {
  return [min, ...LADDER.filter(stop => stop > min && stop < max), max];
}

/** Where a goal sits along the track, 0 to 1. */
export function fractionOfGoal(value: number, stops: number[]): number {
  const last = stops.length - 1;
  if (last < 1 || value <= stops[0]) return 0;
  if (value >= stops[last]) return 1;
  const index = stops.findIndex((_, i) => value <= stops[i + 1]);
  const from = stops[index];
  const to = stops[index + 1];
  return (index + (value - from) / (to - from)) / last;
}

/** The goal at a point along the track, 0 to 1, before it is snapped. */
export function goalAtFraction(fraction: number, stops: number[]): number {
  const last = stops.length - 1;
  if (last < 1) return stops[0] ?? 0;
  const position = Math.min(1, Math.max(0, fraction)) * last;
  const index = Math.min(Math.floor(position), last - 1);
  return stops[index] + (position - index) * (stops[index + 1] - stops[index]);
}

/** On the increment and inside the range — a goal the server will take. */
export function snapGoal(value: number, range: GoalRange): number {
  const stepped = Math.round(value / range.increment) * range.increment;
  return Math.min(range.max, Math.max(range.min, stepped));
}

/** `3K`, `7.5K`, `20K` — a mark under the slider. */
export function formatStopLabel(steps: number): string {
  return `${Number((steps / 1000).toFixed(1))}K`;
}

/**
 * What the suggestion was worked out from, in the words the design uses —
 * "Based on your profile (age, BMI and activity level)," — naming only what
 * the server actually had.
 */
export function recommendationBasis(basedOn: StepGoal['basedOn']): string {
  const known = [basedOn.age ? 'age' : null, basedOn.bmi ? 'BMI' : null].filter(
    Boolean,
  );
  return known.length === 0
    ? 'Based on your activity level,'
    : `Based on your profile (${known.join(', ')} and activity level),`;
}
