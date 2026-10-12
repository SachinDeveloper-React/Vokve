import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Divider } from '../../components/layout/Divider';
import { PageHeader } from '../../components/layout/PageHeader';
import { HStack, VStack } from '../../components/layout/Stack';
import { StreakDayEventRow } from '../../components/streak/StreakDayEventRow';
import { StreakDayMetricsCard } from '../../components/streak/StreakDayMetricsCard';
import { StreakDayNav } from '../../components/streak/StreakDayNav';
import { StreakDayStatusCard } from '../../components/streak/StreakDayStatusCard';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useStreakDay, useStreakDayEvents } from '../../hooks/useStreakDay';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { StreakDayEvent } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';
import { addDays, formatWeekdayShort, todayIso } from '../../utils/date';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    list: { paddingBottom: spacing.xxxl },
    header: { gap: spacing.md, paddingBottom: spacing.md },
    footer: { paddingVertical: spacing.lg },
  });

/**
 * One day of the streak, opened from a cell of the calendar or a row of the
 * record: how the day went, the figures behind it, and everything it holds.
 *
 * Two reads rather than one (`GET /streak/day` and `GET /streak/day/events`).
 * The cards at the top are one small answer the screen can paint
 * immediately; the log under them is unbounded — a day of water, meals and
 * coin movements — and pages in behind them, so a busy day never holds up the
 * verdict the user tapped to see.
 *
 * Paging to the day before happens in place rather than by pushing another
 * screen: a member reading back through a bad week would otherwise build a
 * stack of seven identical screens to get out of. Which days can be reached
 * is the server's answer, not arithmetic done here — `previousDate` stops at
 * the first day on record, `nextDate` at today.
 *
 * A `FlatList` rather than a `ScrollView`: the log is the long part, and the
 * cards ride on it as a header so there is one scroll rather than a list
 * nested inside one.
 */
export const StreakDayScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RootStackScreenProps<'StreakDay'>['route']>();

  const [date, setDate] = useState(params.date);
  // A second `navigate('StreakDay')` while this screen is mounted changes the
  // param rather than mounting another one, so the day has to follow it.
  useEffect(() => setDate(params.date), [params.date]);

  const day = useStreakDay(date);
  const log = useStreakDayEvents(date);

  const today = day.data?.today ?? todayIso();
  const relative =
    date === today
      ? 'Today'
      : date === addDays(today, -1)
      ? 'Yesterday'
      : formatWeekdayShort(date);

  // A pull asks both reads again. The spinner follows the log's own first
  // page: the day read keeps what it is showing while it re-asks, so it has
  // no "refreshing" of its own to drive the control with.
  const { reload } = day;
  const { refresh } = log;
  const onRefresh = useCallback(() => {
    reload();
    refresh();
  }, [refresh, reload]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Streak');
  }, [navigation]);

  const renderItem = useCallback(
    ({ item, index }: { item: StreakDayEvent; index: number }) => (
      <VStack>
        {index > 0 ? <Divider /> : null}
        <StreakDayEventRow event={item} />
      </VStack>
    ),
    [],
  );

  const keyExtractor = useCallback((item: StreakDayEvent) => item.id, []);

  if (day.data === null) {
    return (
      <Screen edges={['top']}>
        <PageHeader
          title="Day Details"
          subtitle={relative}
          onPressBack={onPressBack}
        />
        <LoadState
          loading={day.loading}
          title="Couldn't load this day"
          message={day.error}
          onRetry={day.reload}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <PageHeader
        title="Day Details"
        subtitle={relative}
        onPressBack={onPressBack}
      />

      <FlatList
        data={log.events}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onEndReached={log.loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={log.isLoading && log.events.length > 0}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <VStack style={styles.header}>
            <StreakDayNav
              date={date}
              previousDate={day.data.previousDate}
              nextDate={day.data.nextDate}
              onPressDate={setDate}
            />

            <StreakDayStatusCard day={day.data} />

            <StreakDayMetricsCard metrics={day.data.metrics} />

            {log.total === 0 ? null : (
              <HStack align="center" justify="between" gap="sm">
                <AppText variant="h3" accessibilityRole="header">
                  Day Log
                </AppText>
                <AppText variant="micro" color="textSecondary">
                  {`${log.total} ${log.total === 1 ? 'entry' : 'entries'}`}
                </AppText>
              </HStack>
            )}
          </VStack>
        }
        ListEmptyComponent={
          log.isLoading ? (
            <ActivityIndicator color={colors.primary} style={styles.footer} />
          ) : log.error !== null ? (
            <VStack gap="sm" py="md" align="center">
              <AppText variant="micro" color="textSecondary" center>
                {log.error}
              </AppText>
              <Button label="Try again" variant="ghost" onPress={log.refresh} />
            </VStack>
          ) : (
            <AppText variant="caption" color="textSecondary" center>
              {day.data.status === 'upcoming'
                ? 'Nothing here yet — this day has not happened.'
                : 'Nothing was logged on this day.'}
            </AppText>
          )
        }
        ListFooterComponent={
          log.isLoadingMore ? (
            <ActivityIndicator color={colors.primary} style={styles.footer} />
          ) : log.error !== null && log.events.length > 0 ? (
            <AppText variant="micro" color="textSecondary" center>
              {log.error}
            </AppText>
          ) : (
            <VStack />
          )
        }
      />
    </Screen>
  );
};
