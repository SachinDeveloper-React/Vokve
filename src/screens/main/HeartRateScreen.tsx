import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Heart } from 'lucide-react-native';
import { AddReadingSheet } from '../../components/health/AddReadingSheet';
import { LiveMeasureCard } from '../../components/health/LiveMeasureCard';
import { RecentVitalReadingsCard } from '../../components/health/RecentVitalReadingsCard';
import { VitalHeader } from '../../components/health/VitalHeader';
import { VitalTipCard } from '../../components/health/VitalTipCard';
import { HeartRateHeroCard } from '../../components/heart/HeartRateHeroCard';
import { HeartRateTrendCard } from '../../components/heart/HeartRateTrendCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useTip } from '../../hooks/useContent';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import {
  useReadingsOfKind,
  useVitalsStore,
  useVitalsSynced,
} from '../../stores/vitalsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/** How many readings the trend plots and the list shows. */
const TREND_POINTS = 8;
const RECENT_ROWS = 4;

/**
 * Whether a sensor can take the reading itself.
 *
 * A constant rather than a check, and deliberately so: this build has no
 * health integration, and the card above it says "not connected" instead of
 * promising a live measurement it cannot make. It becomes a real capability
 * check the day the native side lands.
 */
const HAS_SENSOR = false;

/**
 * Heart rate on its own: the latest reading, where it sits clinically, and how
 * it has moved.
 *
 * Everything comes from the vitals store — the server's readings with any
 * still on their way, the same list the checkup screen's tile reads — so a
 * reading logged here changes that tile in the same breath. The tip is the
 * day's from the server's content.
 * Whether a reading is normal is worked out from the number at render, never
 * stored beside it, which is what stops a figure and its verdict drifting
 * apart on the one screen where that would matter.
 */
export const HeartRateScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();

  const readings = useReadingsOfKind('heart_rate', TREND_POINTS);
  const addReading = useVitalsStore(s => s.addReading);
  const synced = useVitalsSynced();
  const isSyncing = useVitalsStore(s => s.isSyncing);
  const syncError = useVitalsStore(s => s.syncError);
  const hydrateFromServer = useVitalsStore(s => s.hydrateFromServer);
  const tip = useTip('heart_rate');
  useRefreshOnFocus(useVitalsStore.getState().refreshIfStale);

  const [isLogOpen, setLogOpen] = useState(false);
  const openLog = useCallback(() => setLogOpen(true), []);
  const closeLog = useCallback(() => setLogOpen(false), []);

  const latest = readings[0];

  // The chart runs left to right in time; the store keeps its readings newest
  // first, which is the order the list below wants.
  const trend = useMemo(() => [...readings].reverse(), [readings]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  // The explainer and the full archive have no screens yet. Wired as no-ops
  // rather than left off, so each control keeps the shape it will ship with
  // and only the handler changes when its screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <VitalHeader
          title="Heart Rate"
          onPressBack={onPressBack}
          onPressInfo={notImplemented}
        />

        {!synced ? (
          <LoadState
            loading={isSyncing || syncError === null}
            title="Couldn't load your readings"
            message={syncError}
            onRetry={hydrateFromServer}
          />
        ) : latest ? (
          <HeartRateHeroCard bpm={latest.value} />
        ) : (
          <EmptyState
            title="No reading yet"
            message="Log your first heart rate and this is where it will sit."
            actionLabel="Log a reading"
            onAction={openLog}
          />
        )}

        <LiveMeasureCard
          title="Live Heart Rate"
          connectedCopy="Real-time measurement using your device"
          available={HAS_SENSOR}
          onPressMeasure={openLog}
        />

        {trend.length > 1 ? (
          <HeartRateTrendCard readings={trend} periodLabel="7 Days" />
        ) : null}

        <RecentVitalReadingsCard
          readings={readings.slice(0, RECENT_ROWS)}
          icon={Heart}
          tint={colors.destructive}
          viewAllLabel="View all heart rate readings"
          onPressViewAll={notImplemented}
        />

        {tip ? (
          <VitalTipCard
            title={tip.title ?? 'Tip'}
            message={tip.text}
            tint={colors.destructive}
            onPress={notImplemented}
          />
        ) : null}
      </ScrollView>

      <AddReadingSheet
        visible={isLogOpen}
        kind="heart_rate"
        onSubmit={addReading}
        onClose={closeLog}
      />
    </Screen>
  );
};
