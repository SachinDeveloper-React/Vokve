import React, { Fragment, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { VitalReadingRow } from '../../components/health/VitalReadingRow';
import { VITAL_ORDER, VITAL_STYLE } from '../../components/health/vitals';
import { Divider } from '../../components/layout/Divider';
import { VStack } from '../../components/layout/Stack';
import { PageHeader } from '../../components/layout/PageHeader';
import { AppText } from '../../components/ui/AppText';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  FilterChips,
  type FilterOption,
} from '../../components/ui/FilterChips';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import {
  useVitalReadings,
  useVitalsStore,
  useVitalsSynced,
} from '../../stores/vitalsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import type { RootStackParamList } from '../../types/navigation';
import type { VitalKind, VitalReading } from '../../types/models';
import { formatLongDate, toIsoDate, type IsoDate } from '../../utils/date';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/** `all` is every kind at once, which is what the screen opens on. */
type Filter = VitalKind | 'all';

interface DayGroup {
  day: IsoDate;
  readings: VitalReading[];
}

/**
 * The readings under the day they were taken, newest day first.
 *
 * Grouped rather than listed flat because a stamp on every row is the same
 * date written ten times: the heading says the day once and the rows keep
 * only their time, which is the part that differs.
 */
function groupByDay(readings: VitalReading[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const reading of readings) {
    const at = new Date(reading.recordedAt);
    // A stamp the phone cannot parse would otherwise open a group called
    // "Invalid Date" and sort unpredictably against the real ones.
    if (Number.isNaN(at.getTime())) continue;
    const day = toIsoDate(at);
    const open = groups[groups.length - 1];
    if (open !== undefined && open.day === day) {
      open.readings.push(reading);
    } else {
      groups.push({ day, readings: [reading] });
    }
  }
  return groups;
}

/**
 * Everything ever logged — where "View All" leads, from the checkup screen
 * and from a vital's own screen.
 *
 * Opened on one kind when it is reached from that kind's screen, and on all
 * of them from the checkup, which is the difference between "show me my
 * pulse" and "show me what I have been logging". The chips move between the
 * two either way, so neither route is a dead end.
 *
 * A plain scroll view rather than a recycling list: these readings are typed
 * in by hand, so the archive is tens of rows and not thousands, and day
 * headings in a recycled list cost more than they are worth at that length.
 *
 * Read from the vitals store, so a reading logged anywhere in the app appears
 * here without this screen asking for anything.
 */
export const VitalsHistoryScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'VitalsHistory'>>();

  const readings = useVitalReadings();
  const synced = useVitalsSynced();
  const isSyncing = useVitalsStore(s => s.isSyncing);
  const syncError = useVitalsStore(s => s.syncError);
  const hydrateFromServer = useVitalsStore(s => s.hydrateFromServer);
  useRefreshOnFocus(useVitalsStore.getState().refreshIfStale);

  const [filter, setFilter] = useState<Filter>(route.params?.kind ?? 'all');

  /**
   * A chip per kind that has actually been logged, with its count, plus
   * "All". A chip for a vital with no readings behind it is a filter that can
   * only ever lead to an empty list.
   */
  const options = useMemo<FilterOption<Filter>[]>(() => {
    const counts = new Map<VitalKind, number>();
    for (const reading of readings) {
      counts.set(reading.kind, (counts.get(reading.kind) ?? 0) + 1);
    }
    return [
      { value: 'all' as Filter, label: 'All', count: readings.length },
      ...VITAL_ORDER.filter(kind => counts.has(kind)).map(kind => ({
        value: kind as Filter,
        label: VITAL_STYLE[kind].label,
        count: counts.get(kind),
      })),
    ];
  }, [readings]);

  const groups = useMemo(
    () =>
      groupByDay(
        filter === 'all'
          ? readings
          : readings.filter(reading => reading.kind === filter),
      ),
    [filter, readings],
  );

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('HealthCheckup');
  }, [navigation]);

  return (
    <Screen edges={['top']} padded>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader
          title="All Readings"
          subtitle="Every vital you have logged"
          onPressBack={onPressBack}
        />

        {!synced ? (
          <LoadState
            loading={isSyncing || syncError === null}
            title="Couldn't load your readings"
            message={syncError}
            onRetry={hydrateFromServer}
          />
        ) : readings.length === 0 ? (
          <EmptyState
            title="Nothing logged yet"
            message="Readings you log will be kept here, newest first."
            actionLabel="Back to the checkup"
            onAction={onPressBack}
          />
        ) : (
          <>
            <FilterChips
              options={options}
              value={filter}
              onChange={setFilter}
            />

            {groups.length === 0 ? (
              <AppText variant="micro" color="textSecondary">
                Nothing logged for this one yet.
              </AppText>
            ) : (
              groups.map(group => (
                <Card key={group.day} radius="xl" padding="base">
                  <VStack gap="sm">
                    <AppText variant="label" color="textSecondary">
                      {formatLongDate(group.day)}
                    </AppText>

                    <VStack>
                      {group.readings.map((reading, index) => (
                        <Fragment key={reading.id}>
                          {index > 0 ? <Divider /> : null}
                          <VitalReadingRow reading={reading} timeOnly />
                        </Fragment>
                      ))}
                    </VStack>
                  </VStack>
                </Card>
              ))
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
};
