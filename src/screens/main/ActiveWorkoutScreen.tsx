import React, { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { useUnits } from '../../stores/settingsStore';
import { useActiveWorkout, useWorkoutStore } from '../../stores/workoutStore';
import type { RootStackScreenProps } from '../../types/navigation';
import { formatCompactNumber, formatWeight } from '../../utils/format';

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    header: { paddingTop: spacing.sm, gap: spacing.xxs },
    exerciseHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    setRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    check: {
      width: 28,
      height: 28,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checked: {
      backgroundColor: colors.success,
      borderColor: colors.success,
    },
    addSet: { paddingTop: spacing.sm },
    footer: { gap: spacing.sm, marginTop: spacing.base },
  });

export const ActiveWorkoutScreen = ({
  navigation,
}: RootStackScreenProps<'ActiveWorkout'>) => {
  const styles = useThemedStyles(makeStyles);
  const workout = useActiveWorkout();
  const units = useUnits();

  const addSet = useWorkoutStore(s => s.addSet);
  const updateSet = useWorkoutStore(s => s.updateSet);
  const finishWorkout = useWorkoutStore(s => s.finishWorkout);
  const discardWorkout = useWorkoutStore(s => s.discardWorkout);

  const handleFinish = useCallback(() => {
    finishWorkout().finally(() => navigation.goBack());
  }, [finishWorkout, navigation]);

  const handleDiscard = useCallback(() => {
    discardWorkout();
    navigation.goBack();
  }, [discardWorkout, navigation]);

  if (!workout) {
    return (
      <Screen edges={['top']}>
        <EmptyState
          title="No active workout"
          message="Start one from the Workouts tab and it will appear here."
          actionLabel="Go back"
          onAction={navigation.goBack}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <AppText variant="h1">{workout.title}</AppText>
          <AppText variant="label" color="textTertiary">
            {formatCompactNumber(workout.totalVolumeKg)}{' '}
            {units === 'metric' ? 'kg' : 'lb'} volume so far
          </AppText>
        </View>

        {workout.exercises.map(entry => (
          <Card key={entry.id}>
            <View style={styles.exerciseHeader}>
              <AppText variant="h3">{entry.exercise.name}</AppText>
              <AppText variant="caption" color="textTertiary">
                {entry.sets.length} sets
              </AppText>
            </View>

            {entry.sets.map((set, index) => (
              <View key={set.id} style={styles.setRow}>
                <AppText variant="caption" color="textTertiary">
                  Set {index + 1}
                </AppText>
                <AppText variant="bodyStrong">
                  {set.reps} × {formatWeight(set.weightKg, units)}
                </AppText>
                <Pressable
                  onPress={() =>
                    updateSet(entry.id, set.id, { completed: !set.completed })
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: set.completed }}
                  accessibilityLabel={`Set ${index + 1} complete`}
                  style={[styles.check, set.completed && styles.checked]}
                >
                  {set.completed ? (
                    <AppText variant="caption" color="text">
                      ✓
                    </AppText>
                  ) : null}
                </Pressable>
              </View>
            ))}

            <View style={styles.addSet}>
              <Button
                label="Add set"
                variant="secondary"
                size="sm"
                onPress={() => addSet(entry.id)}
              />
            </View>
          </Card>
        ))}

        <View style={styles.footer}>
          <Button label="Finish workout" size="lg" fullWidth onPress={handleFinish} />
          <Button
            label="Discard"
            variant="ghost"
            fullWidth
            onPress={handleDiscard}
          />
        </View>
      </ScrollView>
    </Screen>
  );
};
