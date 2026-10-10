import React, { Fragment, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { CustomRangeRow } from '../../components/history/CustomRangeRow';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import {
  HistoryRangeTabs,
  type HistoryRange,
} from '../../components/history/HistoryRangeTabs';
import { HydrationHistoryDayRow } from '../../components/hydration/HydrationHistoryDayRow';
import { HydrationHistorySummary } from '../../components/hydration/HydrationHistorySummary';
import { HydrationLogRow } from '../../components/hydration/HydrationLogRow';
import { Divider } from '../../components/layout/Divider';
import { VStack } from '../../components/layout/Stack';
import { AppText } from '../../components/ui/AppText';
import { Card } from '../../components/ui/Card';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useHydrationDay, useHydrationHistory } from '../../hooks/useHydration';
import { useCoinBalance } from '../../stores/coinsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import {
  addDays,
  daysBetween,
  formatDateRange,
  formatLongDate,
  todayIso,
  type IsoDate,
} from '../../utils/date';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    drinks: { paddingBottom: spacing.sm },
  });

/** The longest custom span the screen will draw, matching the server's ceiling. */
const MAX_CUSTOM_DAYS = 366;

/** How many days each fixed range covers, ending today. */
const LENGTHS: Record<Exclude<HistoryRange, 'custom'>, number> = {
  daily: 7,
  weekly: 28,
  monthly: 90,
};

/** The two ends of the span a range asks the server for. */
function boundsFor(
  range: HistoryRange,
  from: IsoDate,
  to: IsoDate,
): { from: IsoDate; to: IsoDate } {
  if (range === 'custom') {
    // Drawn either way round, so a user who sets the ends backwards gets
    // their range rather than an error.
    const ordered = daysBetween(from, to) >= 0 ? { from, to } : { from: to, to: from };
    const span = Math.abs(daysBetween(from, to)) + 1;
    return span <= MAX_CUSTOM_DAYS
      ? ordered
      : { from: addDays(ordered.to, -(MAX_CUSTOM_DAYS - 1)), to: ordered.to };
  }
  const today = todayIso();
  return { from: addDays(today, -(LENGTHS[range] - 1)), to: today };
}

const TITLES: Record<HistoryRange, string> = {
  daily: 'This week',
  weekly: 'Last four weeks',
  monthly: 'Last three months',
  custom: 'Your range',
};

/**
 * The water record, read backwards.
 *
 * Everything is the server's (`GET /hydration/history`, `/hydration/day`),
 * including every figure in the summary: the app draws them and recomputes
 * none of them, because the average here and the average on the hydration
 * screen's stats card have to be the same number, and two places dividing
 * by their own denominator is exactly how they stop being.
 *
 * Asked again whenever the server confirms a change to today, so a glass
 * logged this morning is in this history a moment later.
 *
 * A day nobody logged is drawn as "nothing logged" rather than as 0.0 L —
 * those are different facts, and a record that blurred them would be wrong
 * about the one thing it exists to show. Any row opens on its own drinks,
 * so the history is something a user can walk into rather than only read.
 */
export const HydrationHistoryScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const coins = useCoinBalance();

  const [range, setRange] = useState<HistoryRange>('daily');
  const [customFrom, setCustomFrom] = useState<IsoDate>(() =>
    addDays(todayIso(), -13),
  );
  const [customTo, setCustomTo] = useState<IsoDate>(todayIso);
  /** Which end the calendar is open for, or null. */
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  /** The day whose drinks are showing, or null. */
  const [openDay, setOpenDay] = useState<IsoDate | null>(null);

  const bounds = useMemo(
    () => boundsFor(range, customFrom, customTo),
    [customFrom, customTo, range],
  );
  const history = useHydrationHistory(bounds.from, bounds.to);
  const day = useHydrationDay(openDay);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Hydration');
  }, [navigation]);

  const onChangeRange = useCallback((next: HistoryRange) => {
    setRange(next);
    // The open row belonged to the old span and may not be in the new one.
    setOpenDay(null);
  }, []);

  const onToggleDay = useCallback(
    (date: IsoDate) => setOpenDay(current => (current === date ? null : date)),
    [],
  );

  const openFrom = useCallback(() => setPicking('from'), []);
  const openTo = useCallback(() => setPicking('to'), []);
  const closePicker = useCallback(() => setPicking(null), []);

  const onPickDate = useCallback(
    (date: IsoDate) => {
      if (picking === 'from') {
        setCustomFrom(date);
      } else if (picking === 'to') {
        setCustomTo(date);
      }
      setPicking(null);
      setOpenDay(null);
    },
    [picking],
  );

  const subtitle = useMemo(
    () => formatDateRange(bounds.from, bounds.to),
    [bounds.from, bounds.to],
  );

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <HistoryHeader
          coins={coins}
          onPressBack={onPressBack}
          title="Water History"
          subtitle={subtitle}
        />

        <HistoryRangeTabs value={range} onChange={onChangeRange} />

        {range === 'custom' ? (
          <CustomRangeRow
            from={customFrom}
            to={customTo}
            onPressFrom={openFrom}
            onPressTo={openTo}
          />
        ) : null}

        {history.data ? (
          <>
            <HydrationHistorySummary
              title={TITLES[range]}
              summary={history.data.summary}
            />

            <VStack gap="sm">
              <AppText variant="h3">Day by day</AppText>

              <Card radius="xl" padding="base">
                <VStack>
                  {history.data.days.map((entry, index) => (
                    <Fragment key={entry.date}>
                      {index > 0 ? <Divider /> : null}
                      <HydrationHistoryDayRow
                        day={entry}
                        expanded={openDay === entry.date}
                        onPress={onToggleDay}
                      />

                      {openDay === entry.date ? (
                        <VStack style={styles.drinks}>
                          {day.data && day.data.date === entry.date ? (
                            day.data.entries.length > 0 ? (
                              day.data.entries.map(drink => (
                                // No delete: a past day is a record, not a
                                // worksheet, and the control for a mis-tap
                                // belongs on the day it was made.
                                <HydrationLogRow key={drink.id} entry={drink} />
                              ))
                            ) : (
                              <AppText variant="micro" color="textTertiary">
                                Nothing was logged on{' '}
                                {formatLongDate(entry.date)}.
                              </AppText>
                            )
                          ) : (
                            <LoadState
                              loading={day.loading}
                              title="Couldn't load that day"
                              message={day.error}
                              onRetry={day.reload}
                            />
                          )}
                        </VStack>
                      ) : null}
                    </Fragment>
                  ))}
                </VStack>
              </Card>
            </VStack>
          </>
        ) : (
          <LoadState
            loading={history.loading}
            title="Couldn't load your water history"
            message={history.error}
            onRetry={history.reload}
          />
        )}
      </ScrollView>

      <CalendarSheet
        visible={picking !== null}
        value={picking === 'to' ? customTo : customFrom}
        onChange={onPickDate}
        onClose={closePicker}
        title={picking === 'to' ? 'To' : 'From'}
      />
    </Screen>
  );
};

