import type { ThemeColors } from '../../constants/colors';
import type { ChallengeMetric } from '../../types/models';
import { formatCompactNumber, formatGrouped } from '../../utils/format';

/**
 * A colour token name rather than a colour: both cards render in either theme,
 * and a literal picked for one of them would be wrong in the other. Resolved
 * with `colors[tint]` at render.
 */
export type MetricTint = Extract<
  keyof ThemeColors,
  'success' | 'avatarPurple' | 'primary' | 'gold' | 'destructive'
>;

interface MetricPresentation {
  tint: MetricTint;
  /** The unit written after a progress figure — "7,543 / 10,000 steps". */
  unit: string;
}

/**
 * How each metric reads and looks, declared once.
 *
 * A challenge and the achievement it pays out sit on the same screen, so the
 * two have to agree: calories purple in the progress bar and blue on the badge
 * above it would read as two unrelated things. Exhaustive by type — adding a
 * `ChallengeMetric` without an entry is a compile error rather than a row that
 * renders with no colour and no unit.
 */
export const METRIC_STYLE: Record<ChallengeMetric, MetricPresentation> = {
  steps: { tint: 'success', unit: 'steps' },
  calories: { tint: 'avatarPurple', unit: 'Cal' },
  minutes: { tint: 'primary', unit: 'min' },
  days: { tint: 'gold', unit: 'days' },
  workouts: { tint: 'destructive', unit: 'workouts' },
};

/**
 * "7,543 / 10,000 steps".
 *
 * Grouped below ten thousand and compacted above it: a weekly step goal runs
 * to six digits, and "42,350 / 70,000 steps" is wider than the row it has to
 * share with a reward chip.
 */
export function formatProgress(
  progress: number,
  goal: number,
  metric: ChallengeMetric,
): string {
  const write = (value: number) =>
    goal >= 100_000 ? formatCompactNumber(value) : formatGrouped(value);

  return `${write(progress)} / ${write(goal)} ${METRIC_STYLE[metric].unit}`;
}
