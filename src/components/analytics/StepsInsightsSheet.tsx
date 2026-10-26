import React, { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { formatActiveTime, formatGrouped } from '../../utils/format';
import type { ActivityRange } from '../../types/models';
import { BottomSheet, BottomSheetScrollView } from '../disclosure/BottomSheet';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import type { AnalyticsRange } from './AnalyticsRangeFilter';
import type { OverviewPoint } from './StepsOverviewCard';

/** What one bar covers, in the words the rows use for it. */
const BUCKET_NOUN: Record<AnalyticsRange, string> = {
  day: 'hour',
  week: 'day',
  month: 'week',
  year: 'month',
};

export interface InsightRow {
  label: string;
  value: string;
}

/** The tallest bar of the period, or null when nothing was counted. */
function peakOf(points: OverviewPoint[]): OverviewPoint | null {
  return points.reduce<OverviewPoint | null>(
    (best, point) => (point.steps > (best?.steps ?? 0) ? point : best),
    null,
  );
}

/**
 * The period's figures, in the order they are read.
 *
 * Distance, calories and active time are scaled to the verified share of the
 * period's steps, exactly as `verifiedActivityOf` scales a single day: the
 * screen above shows nobody a kilometre that came with steps the server would
 * not count, and a sheet that opened over it saying otherwise would be the one
 * number on the screen that disagreed with the rest.
 *
 * Exported for the tests, and because the arithmetic is the whole of what this
 * sheet says — it is worth being able to check it without a renderer.
 */
export function insightRows(
  range: AnalyticsRange,
  points: OverviewPoint[],
  totals: ActivityRange['totals'],
): InsightRow[] {
  const share =
    totals.steps > 0 ? Math.min(1, totals.verifiedSteps / totals.steps) : 1;
  const peak = peakOf(points);
  const rows: InsightRow[] = [
    { label: 'Total steps', value: formatGrouped(totals.verifiedSteps) },
  ];

  // An average over the days that counted anything, not over the period: a
  // week asked about on Tuesday has five days that have not happened yet, and
  // dividing by seven would report a slump that nobody walked.
  if (range !== 'day') {
    rows.push({
      label: 'Daily average',
      value:
        totals.activeDays > 0
          ? formatGrouped(Math.round(totals.verifiedSteps / totals.activeDays))
          : '—',
    });
    rows.push({
      label: 'Active days',
      value: String(totals.activeDays),
    });
  }

  rows.push({
    label: `Busiest ${BUCKET_NOUN[range]}`,
    value:
      peak && peak.steps > 0
        ? `${peak.label} · ${formatGrouped(peak.steps)}`
        : '—',
  });
  rows.push({
    label: 'Distance',
    value: `${(totals.distanceKm * share).toFixed(1)} km`,
  });
  rows.push({
    label: 'Calories burned',
    value: formatGrouped(Math.round(totals.caloriesBurned * share)),
  });
  rows.push({
    label: 'Active time',
    value: formatActiveTime(totals.activeMinutes * share),
  });

  return rows;
}

/** Where the period stands against the daily goal, in one sentence. */
export function goalLine(
  range: AnalyticsRange,
  totals: ActivityRange['totals'],
  goal: number,
): string {
  if (totals.verifiedSteps === 0) {
    return 'No steps counted in this period yet.';
  }
  const target = Math.max(1, goal);
  if (range === 'day') {
    const percent = Math.round((totals.verifiedSteps / target) * 100);
    return `That total is ${percent}% of the ${formatGrouped(
      goal,
    )} step daily goal.`;
  }
  const average =
    totals.activeDays > 0 ? totals.verifiedSteps / totals.activeDays : 0;
  const percent = Math.round((average / target) * 100);
  return `Your daily average is ${percent}% of the ${formatGrouped(
    goal,
  )} step goal.`;
}

const FigureRow = memo(({ label, value }: InsightRow) => (
  <HStack
    align="center"
    justify="between"
    gap="md"
    accessible
    accessibilityLabel={`${label}, ${value}`}
  >
    <AppText variant="body" color="textSecondary" style={styles.rowLabel}>
      {label}
    </AppText>
    <AppText variant="bodyStrong" numberOfLines={1}>
      {value}
    </AppText>
  </HStack>
));

FigureRow.displayName = 'FigureRow';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The period the chart is drawing — the rows follow it. */
  range: AnalyticsRange;
  /** What that period is called — "This week, day by day". */
  caption: string;
  /** The bars as drawn, so the sheet reads the same series as the chart. */
  points: OverviewPoint[];
  /** The server's totals for the period; null until the read lands. */
  totals: ActivityRange['totals'] | null;
  goal: number;
}

/**
 * What the chart adds up to, behind "View Insights".
 *
 * Every figure is the same read the chart is drawn from — the period's totals
 * as the server added them up, and the tallest bar of the series on screen —
 * so the sheet cannot say anything the card above it is not already showing.
 * It asks the server for nothing of its own: a breakdown that needed a second
 * round trip would be empty for a beat every time it opened, and offline it
 * would be empty for good.
 */
export const StepsInsightsSheet = memo(
  ({ visible, onClose, range, caption, points, totals, goal }: Props) => {
    const rows = useMemo(
      () => (totals ? insightRows(range, points, totals) : []),
      [range, points, totals],
    );

    return (
      <BottomSheet visible={visible} onClose={onClose} title="Steps Insights">
        <BottomSheetScrollView showsVerticalScrollIndicator={false}>
          <VStack gap="base">
            <AppText variant="caption" color="textSecondary">
              {caption}
            </AppText>

            {totals === null ? (
              <AppText variant="body" color="textSecondary">
                These figures have not arrived yet. They will be here as soon as
                the period loads.
              </AppText>
            ) : (
              <>
                <VStack gap="md">
                  {rows.map((row, index) => (
                    <React.Fragment key={row.label}>
                      {index === 0 ? null : <Divider />}
                      <FigureRow label={row.label} value={row.value} />
                    </React.Fragment>
                  ))}
                </VStack>

                <AppText variant="caption" color="textTertiary">
                  {goalLine(range, totals, goal)}
                </AppText>

                <AppText variant="micro" color="textTertiary">
                  Only the steps the server has verified are counted here, so
                  these figures match the rest of the screen.
                </AppText>
              </>
            )}
          </VStack>
        </BottomSheetScrollView>
      </BottomSheet>
    );
  },
);

StepsInsightsSheet.displayName = 'StepsInsightsSheet';

const styles = StyleSheet.create({
  /** The label yields the row's width to the figure, never the other way. */
  rowLabel: { flexShrink: 1 },
});
