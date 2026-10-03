import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { Box } from '../../components/layout/Box';
import { SourceChecksCard } from '../../components/steps/SourceChecksCard';
import { SourceDeviceCard } from '../../components/steps/SourceDeviceCard';
import { SourceRecordsCard } from '../../components/steps/SourceRecordsCard';
import { SourcesSummaryCard } from '../../components/steps/SourcesSummaryCard';
import { SourceUploadsCard } from '../../components/steps/SourceUploadsCard';
import { StepTrackingHeader } from '../../components/steps/StepTrackingHeader';
import { DateChip } from '../../components/streak/DateChip';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useStepSources } from '../../hooks/useActivity';
import { syncStepsNow } from '../../services/steps';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { todayIso, type IsoDate } from '../../utils/date';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * Where a day's steps came from and how they were matched: the answer and
 * the server's reasons for it, each phone that sent the day with its own
 * count and every Health Connect app on it, the raw records, the uploads,
 * and — where the server shows them — the fraud layers' scores and flags.
 *
 * Every word and figure here is the server's (`GET /activity/sources`); the
 * phone only sent the evidence. Pulling down sends what this phone has
 * counted and asks again.
 */
export const StepSourcesScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();

  const [date, setDate] = useState<IsoDate>(todayIso());
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { data: report, loading, error, reload } = useStepSources(date);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncStepsNow();
    } finally {
      reload();
      setRefreshing(false);
    }
  }, [reload]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <StepTrackingHeader
          onPressBack={onPressBack}
          title="Step Sources"
          subtitle="Where your steps come from, and how they are matched."
        />

        <DateChip
          date={date}
          size="sm"
          onPress={() => setCalendarOpen(true)}
          accessibilityHint="Change the day"
        />

        {report ? (
          <>
            <SourcesSummaryCard
              day={report.day}
              explanation={report.explanation}
            />
            {report.devices.map(device => (
              <SourceDeviceCard key={device.deviceId} device={device} />
            ))}
            <SourceRecordsCard records={report.records} />
            <SourceUploadsCard uploads={report.uploads} />
            {report.checks ? <SourceChecksCard checks={report.checks} /> : null}
          </>
        ) : loading ? (
          <Box py="xxxl">
            <ActivityIndicator color={colors.primary} />
          </Box>
        ) : (
          <EmptyState
            title="Couldn't load the sources"
            message={error ?? 'Please try again in a moment.'}
            actionLabel="Try again"
            onAction={reload}
          />
        )}
      </ScrollView>

      <CalendarSheet
        visible={isCalendarOpen}
        value={date}
        onChange={setDate}
        onClose={() => setCalendarOpen(false)}
        title="Show sources for"
      />
    </Screen>
  );
};
