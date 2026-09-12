import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { AppText } from '../../components/ui/AppText';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { useUnits } from '../../stores/settingsStore';
import { useWorkoutHistory } from '../../stores/workoutStore';
import type { Workout } from '../../types/models';
import { formatCompactNumber, formatRelativeDay } from '../../utils/format';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    header: { paddingTop: spacing.sm, paddingBottom: spacing.base },
    separator: { height: spacing.md },
    listContent: { paddingBottom: spacing.xxxl },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    meta: { flexDirection: 'row', gap: spacing.base, marginTop: spacing.xs },
  });

export const ProgressScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const history = useWorkoutHistory();
  const units = useUnits();

  const renderItem = useCallback(
    ({ item }: { item: Workout }) => (
      <Card>
        <View style={styles.row}>
          <AppText variant="h3">{item.title}</AppText>
          <AppText variant="caption" color="textTertiary">
            {formatRelativeDay(item.completedAt ?? item.startedAt)}
          </AppText>
        </View>
        <View style={styles.meta}>
          <AppText variant="caption" color="textSecondary">
            {formatCompactNumber(item.totalVolumeKg)}{' '}
            {units === 'metric' ? 'kg' : 'lb'} volume
          </AppText>
          <AppText variant="caption" color="textSecondary">
            {item.exercises.length} exercises
          </AppText>
        </View>
      </Card>
    ),
    [styles, units],
  );

  const keyExtractor = useCallback((item: Workout) => item.id, []);
  const separator = useCallback(
    () => <View style={styles.separator} />,
    [styles.separator],
  );

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <AppText variant="h1">Progress</AppText>
      </View>

      {history.length === 0 ? (
        <EmptyState
          title="No workouts yet"
          message="Finish your first session and it will show up here with your volume and streak."
        />
      ) : (
        <FlashList
          data={history}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={separator}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </Screen>
  );
};
