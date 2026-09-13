import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AddReadingSheet } from '../../components/health/AddReadingSheet';
import { HealthHeader } from '../../components/health/HealthHeader';
import { HealthScoreCard } from '../../components/health/HealthScoreCard';
import { HealthTipCard } from '../../components/health/HealthTipCard';
import { RecentHistoryCard } from '../../components/health/RecentHistoryCard';
import { TrackProgressCard } from '../../components/health/TrackProgressCard';
import { VitalsCard } from '../../components/health/VitalsCard';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { DateChip } from '../../components/streak/DateChip';
import { Screen } from '../../components/ui/Screen';
import { healthHighlights, healthTip } from '../../constants/seedData';
import { useCurrentUser } from '../../stores/authStore';
import {
  useLatestVitals,
  useRecentVitals,
  useVitalsStore,
} from '../../stores/vitalsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { todayIso, type IsoDate } from '../../utils/date';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/** How much of the history the card shows before "View All". */
const HISTORY_ROWS = 4;

/**
 * The checkup: where every vital stands today, and what has been logged lately.
 *
 * The tiles, the history and the score are three readings of one list. The
 * tiles take the newest of each kind and the history takes the newest overall,
 * both from the vitals store, so logging a reading moves them together — which
 * is the whole reason "Add New Reading" is on this screen rather than behind a
 * form somewhere else.
 *
 * Whether a reading is healthy is worked out at render from the reference
 * ranges rather than stored with it. A number and a verdict that were saved
 * separately could be edited apart, and on a health screen that is the one
 * inconsistency that actually matters.
 */
export const HealthCheckupScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const user = useCurrentUser();

  const latest = useLatestVitals();
  const recent = useRecentVitals(HISTORY_ROWS);
  const addReading = useVitalsStore(s => s.addReading);

  const [date, setDate] = useState<IsoDate>(todayIso());
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const [isAddOpen, setAddOpen] = useState(false);

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);
  const openAdd = useCallback(() => setAddOpen(true), []);
  const closeAdd = useCallback(() => setAddOpen(false), []);

  const onOpenHeartRate = useCallback(
    () => navigation.navigate('HeartRate'),
    [navigation],
  );

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  // The trends screen, the full history and the two explainers have no screens
  // yet. Wired as no-ops rather than left off, so each control keeps the shape
  // it will ship with and only the handler changes when its screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <HealthHeader onPressBack={onPressBack} />

        <DateChip
          date={date}
          size="sm"
          onPress={openCalendar}
          accessibilityHint="Change the day"
        />

        <HealthScoreCard
          score={healthHighlights.score}
          outOf={healthHighlights.outOf}
          name={user?.name}
          onPressInfo={notImplemented}
        />

        <VitalsCard
          latest={latest}
          onPressAdd={openAdd}
          onPressBmiInfo={notImplemented}
          onPressHeartRate={onOpenHeartRate}
        />

        <TrackProgressCard onPressTrends={notImplemented} />

        <RecentHistoryCard
          readings={recent}
          onPressViewAll={notImplemented}
        />

        <HealthTipCard tip={healthTip} />
      </ScrollView>

      <AddReadingSheet
        visible={isAddOpen}
        onSubmit={addReading}
        onClose={closeAdd}
      />

      <CalendarSheet
        visible={isCalendarOpen}
        value={date}
        onChange={setDate}
        onClose={closeCalendar}
        title="Show readings for"
      />
    </Screen>
  );
};
