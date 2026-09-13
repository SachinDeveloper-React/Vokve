import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Heart } from 'lucide-react-native';
import { AddReadingSheet } from '../../components/health/AddReadingSheet';
import { LiveMeasureCard } from '../../components/health/LiveMeasureCard';
import { RecentVitalReadingsCard } from '../../components/health/RecentVitalReadingsCard';
import { VitalHeader } from '../../components/health/VitalHeader';
import { VitalTipCard } from '../../components/health/VitalTipCard';
import { BloodPressureHeroCard } from '../../components/pressure/BloodPressureHeroCard';
import { BloodPressureTrendCard } from '../../components/pressure/BloodPressureTrendCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useReadingsOfKind, useVitalsStore } from '../../stores/vitalsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/** How many readings the trend plots and the list shows. */
const TREND_POINTS = 7;
const RECENT_ROWS = 4;

/** See `HeartRateScreen`: no sensor in this build, and the card says so. */
const HAS_SENSOR = false;

/**
 * Blood pressure on its own: the latest reading, both halves of it, and how
 * it has moved.
 *
 * The same shape as the heart rate screen and built from the same parts —
 * header, live card, readings list, tip — with only the hero and the chart
 * of its own. Everything comes from the vitals store, so a reading logged
 * here changes the checkup's tile in the same breath, and its verdict comes
 * off the same bands that tile uses.
 */
export const BloodPressureScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();

  const readings = useReadingsOfKind('blood_pressure', TREND_POINTS);
  const pulses = useReadingsOfKind('heart_rate', 1);
  const addReading = useVitalsStore(s => s.addReading);

  const [isLogOpen, setLogOpen] = useState(false);
  const openLog = useCallback(() => setLogOpen(true), []);
  const closeLog = useCallback(() => setLogOpen(false), []);

  const latest = readings[0];
  const pulse = pulses[0]?.value ?? null;

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
          title="Blood Pressure"
          onPressBack={onPressBack}
          onPressInfo={notImplemented}
        />

        {latest ? (
          <BloodPressureHeroCard
            systolic={latest.value}
            diastolic={latest.secondary ?? 0}
            pulse={pulse}
          />
        ) : (
          <EmptyState
            title="No reading yet"
            message="Log your first blood pressure and this is where it will sit."
            actionLabel="Log a reading"
            onAction={openLog}
          />
        )}

        <LiveMeasureCard
          title="Live Blood Pressure"
          connectedCopy="Measure using your connected device"
          available={HAS_SENSOR}
          onPressMeasure={openLog}
        />

        {trend.length > 1 ? (
          <BloodPressureTrendCard readings={trend} periodLabel="7 Days" />
        ) : null}

        <RecentVitalReadingsCard
          readings={readings.slice(0, RECENT_ROWS)}
          icon={Heart}
          tint={colors.primary}
          viewAllLabel="View all blood pressure readings"
          onPressViewAll={notImplemented}
        />

        <VitalTipCard
          title="Keep Your BP In Check"
          message="Stay active, sleep well and monitor regularly"
          tint={colors.primary}
          onPress={notImplemented}
        />
      </ScrollView>

      <AddReadingSheet
        visible={isLogOpen}
        kind="blood_pressure"
        onSubmit={addReading}
        onClose={closeLog}
      />
    </Screen>
  );
};
