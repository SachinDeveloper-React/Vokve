import React, { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { VitalTrendCard } from '../../components/health/VitalTrendCard';
import { VITAL_ORDER } from '../../components/health/vitals';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import {
  useVitalReadings,
  useVitalsStore,
  useVitalsSynced,
} from '../../stores/vitalsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/** How many readings of a vital the line plots. */
const TREND_POINTS = 8;
/** Below this there is no shape to draw, only a dot. */
const MIN_POINTS = 2;

/**
 * Every vital's shape over time — where "Track Your Progress" leads.
 *
 * One card per vital that has enough readings to make a line, in the order
 * the checkup's tiles use, so the two screens read the same way down. A vital
 * with one reading is left out rather than drawn as a single dot: the card
 * exists to answer "is this moving", and one point cannot.
 *
 * BMI is the server's, worked out from the newest weight and height rather
 * than logged, so it has no series of its own here — the weight it is derived
 * from does.
 *
 * Read from the vitals store, the same list the checkup screen and the two
 * per-vital screens use, so a reading logged anywhere moves this in the same
 * breath.
 */
export const VitalsTrendsScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();

  const readings = useVitalReadings();
  const synced = useVitalsSynced();
  const isSyncing = useVitalsStore(s => s.isSyncing);
  const syncError = useVitalsStore(s => s.syncError);
  const hydrateFromServer = useVitalsStore(s => s.hydrateFromServer);
  useRefreshOnFocus(useVitalsStore.getState().refreshIfStale);

  /**
   * The newest `TREND_POINTS` of each kind, turned back to oldest-first for
   * the line. The store keeps everything newest first, which is the order a
   * list wants and the reverse of the order a chart does.
   */
  const trends = useMemo(
    () =>
      VITAL_ORDER.map(kind => ({
        kind,
        readings: readings
          .filter(reading => reading.kind === kind)
          .slice(0, TREND_POINTS)
          .reverse(),
      })).filter(trend => trend.readings.length >= MIN_POINTS),
    [readings],
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
          title="Your Progress"
          subtitle="How your vitals have moved"
          onPressBack={onPressBack}
        />

        {!synced ? (
          <LoadState
            loading={isSyncing || syncError === null}
            title="Couldn't load your readings"
            message={syncError}
            onRetry={hydrateFromServer}
          />
        ) : trends.length === 0 ? (
          <EmptyState
            title="Not enough readings yet"
            message="Log a vital twice and its trend will be drawn here."
            actionLabel="Back to the checkup"
            onAction={onPressBack}
          />
        ) : (
          trends.map(trend => (
            <VitalTrendCard
              key={trend.kind}
              kind={trend.kind}
              readings={trend.readings}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
};
