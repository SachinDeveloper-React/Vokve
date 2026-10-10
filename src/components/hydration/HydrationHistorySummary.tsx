import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import type { HydrationHistory } from '../../types/models';
import { formatLongDate } from '../../utils/date';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

interface Props {
  title: string;
  summary: HydrationHistory['summary'];
}

/** "2.4 L", and "—" for a figure there is nothing behind. */
const litres = (ml: number) => `${(ml / 1000).toFixed(1)} L`;

interface FigureProps {
  label: string;
  value: string;
  helper?: string;
}

const Figure = memo(({ label, value, helper }: FigureProps) => (
  <VStack flex={1} gap="xxs">
    <AppText variant="h3">{value}</AppText>
    <AppText variant="miniMicro" color="textSecondary">
      {label}
    </AppText>
    {helper ? (
      <AppText variant="miniMicro" color="textTertiary">
        {helper}
      </AppText>
    ) : null}
  </VStack>
));

Figure.displayName = 'Figure';

/**
 * What a span of days came to.
 *
 * The headline is the daily average, not the total: nobody has a weekly
 * water target, and 17 litres is a number that means nothing until it has
 * been divided by seven. The total is still there, one step down, for
 * whoever wants to do their own arithmetic.
 *
 * Every figure is the server's (`GET /hydration/history`) and none is
 * recomputed here — including the denominators, which are the part that
 * actually matters: the average is over the days that had any water, so a
 * week with two entries cannot read as a week of drinking 600 ml a day,
 * and "2 of 7 days logged" is stated beside it so the reader can see which
 * question was answered.
 */
export const HydrationHistorySummary = memo(({ title, summary }: Props) => {
  const { colors } = useTheme();

  return (
    <VStack gap="sm">
      <AppText variant="h3">{title}</AppText>

      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack gap="sm" align="start">
            <Figure
              label="Daily average"
              value={summary.daysLogged > 0 ? litres(summary.dailyAverageMl) : '—'}
              helper={`${summary.daysLogged} of ${summary.daysInRange} days logged`}
            />
            <View style={[styles.rule, { backgroundColor: colors.border }]} />
            <Figure
              label="Goal reached"
              value={summary.daysLogged > 0 ? `${summary.goalHitRatePercent}%` : '—'}
              helper="of the days you logged"
            />
          </HStack>

          <View style={[styles.line, { backgroundColor: colors.border }]} />

          <HStack gap="sm" align="start">
            <Figure label="Total" value={litres(summary.totalMl)} />
            <View style={[styles.rule, { backgroundColor: colors.border }]} />
            <Figure
              label="Best run"
              value={
                summary.bestStreakDays === 1
                  ? '1 day'
                  : `${summary.bestStreakDays} days`
              }
              helper="at or above your goal"
            />
          </HStack>

          {summary.bestDay ? (
            <AppText variant="micro" color="textSecondary">
              Your biggest day was {formatLongDate(summary.bestDay.date)} —{' '}
              {litres(summary.bestDay.consumedMl)}.
            </AppText>
          ) : null}
        </VStack>
      </Card>
    </VStack>
  );
});

HydrationHistorySummary.displayName = 'HydrationHistorySummary';

const styles = StyleSheet.create({
  rule: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  line: { height: StyleSheet.hairlineWidth },
});
