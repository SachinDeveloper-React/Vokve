import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
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
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useTip } from '../../hooks/useContent';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useHealthScore } from '../../hooks/useVitals';
import { useCurrentUser } from '../../stores/authStore';
import {
  useLatestVitals,
  useRecentVitals,
  useVitalsStore,
  useVitalsSynced,
} from '../../stores/vitalsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
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
 * The tiles and the history are two readings of one list — the server's
 * readings with any still on their way — and the score is the server's
 * (`GET /health/score`), asked again when it confirms a reading. Logging a
 * reading moves the tiles and the history at once, which is the whole reason
 * "Add New Reading" is on this screen rather than behind a form somewhere
 * else. BMI is the server's, worked out from the newest weight and height.
 *
 * Whether a reading is healthy is worked out at render from the reference
 * ranges rather than stored with it. A number and a verdict that were saved
 * separately could be edited apart, and on a health screen that is the one
 * inconsistency that actually matters.
 */
export const HealthCheckupScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const user = useCurrentUser();

  const latest = useLatestVitals();
  const recent = useRecentVitals(HISTORY_ROWS);
  const synced = useVitalsSynced();
  const addReading = useVitalsStore(s => s.addReading);
  const isSyncing = useVitalsStore(s => s.isSyncing);
  const syncError = useVitalsStore(s => s.syncError);
  const hydrateFromServer = useVitalsStore(s => s.hydrateFromServer);
  const refreshIfStale = useVitalsStore(s => s.refreshIfStale);
  const score = useHealthScore();
  const tip = useTip('health');

  useRefreshOnFocus(refreshIfStale);

  const [isPulling, setPulling] = useState(false);
  const { reload: reloadScore } = score;
  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await hydrateFromServer();
    } finally {
      reloadScore();
      setPulling(false);
    }
  }, [hydrateFromServer, reloadScore]);

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

  const onOpenBloodPressure = useCallback(
    () => navigation.navigate('BloodPressure'),
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
        refreshControl={
          <RefreshControl
            refreshing={isPulling}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <HealthHeader onPressBack={onPressBack} />

        <DateChip
          date={date}
          size="sm"
          onPress={openCalendar}
          accessibilityHint="Change the day"
        />

        {score.data ? (
          <HealthScoreCard
            score={score.data.score}
            outOf={score.data.outOf}
            band={score.data.band}
            name={user?.name}
            onPressInfo={notImplemented}
          />
        ) : (
          <LoadState
            loading={score.loading}
            title="Couldn't load your health score"
            message={score.error}
            onRetry={score.reload}
          />
        )}

        {synced ? (
          <>
            <VitalsCard
              latest={latest}
              onPressAdd={openAdd}
              onPressBmiInfo={notImplemented}
              onPressHeartRate={onOpenHeartRate}
              onPressBloodPressure={onOpenBloodPressure}
            />

            <TrackProgressCard onPressTrends={notImplemented} />

            <RecentHistoryCard
              readings={recent}
              onPressViewAll={notImplemented}
            />
          </>
        ) : (
          <LoadState
            loading={isSyncing || syncError === null}
            title="Couldn't load your readings"
            message={syncError}
            onRetry={hydrateFromServer}
          />
        )}

        {tip ? <HealthTipCard tip={tip.text} /> : null}
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
