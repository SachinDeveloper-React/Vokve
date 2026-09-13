import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AddReadingSheet } from '../../components/health/AddReadingSheet';
import { HeartHealthTipCard } from '../../components/heart/HeartHealthTipCard';
import { HeartRateHeader } from '../../components/heart/HeartRateHeader';
import { HeartRateHeroCard } from '../../components/heart/HeartRateHeroCard';
import { HeartRateTrendCard } from '../../components/heart/HeartRateTrendCard';
import { LiveHeartRateCard } from '../../components/heart/LiveHeartRateCard';
import { RecentHeartReadingsCard } from '../../components/heart/RecentHeartReadingsCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useReadingsOfKind, useVitalsStore } from '../../stores/vitalsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';

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
 * Everything comes from the vitals store, the same list the checkup screen's
 * tile reads — so a reading logged here changes that tile in the same breath.
 * Whether a reading is normal is worked out from the number at render, never
 * stored beside it, which is what stops a figure and its verdict drifting
 * apart on the one screen where that would matter.
 */
export const HeartRateScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();

  const readings = useReadingsOfKind('heart_rate', TREND_POINTS);
  const addReading = useVitalsStore(s => s.addReading);

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
        <HeartRateHeader
          onPressBack={onPressBack}
          onPressInfo={notImplemented}
        />

        {latest ? (
          <HeartRateHeroCard bpm={latest.value} />
        ) : (
          <EmptyState
            title="No reading yet"
            message="Log your first heart rate and this is where it will sit."
            actionLabel="Log a reading"
            onAction={openLog}
          />
        )}

        <LiveHeartRateCard
          available={HAS_SENSOR}
          onPressMeasure={openLog}
        />

        {trend.length > 1 ? (
          <HeartRateTrendCard readings={trend} periodLabel="7 Days" />
        ) : null}

        <RecentHeartReadingsCard
          readings={readings.slice(0, RECENT_ROWS)}
          onPressViewAll={notImplemented}
        />

        <HeartHealthTipCard onPress={notImplemented} />
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
