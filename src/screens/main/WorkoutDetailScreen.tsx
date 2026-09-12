import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { useWorkoutStore } from '../../stores/workoutStore';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    header: { paddingTop: spacing.sm, gap: spacing.xs },
    exerciseRow: { flexDirection: 'row', justifyContent: 'space-between' },
  });

export const WorkoutDetailScreen = ({
  route,
  navigation,
}: RootStackScreenProps<'WorkoutDetail'>) => {
  const styles = useThemedStyles(makeStyles);
  const { template } = route.params;
  const startWorkout = useWorkoutStore(s => s.startWorkout);
  const addExercise = useWorkoutStore(s => s.addExercise);

  const handleStart = useCallback(() => {
    startWorkout(template.title);
    template.exercises.forEach(addExercise);
    navigation.replace('ActiveWorkout');
  }, [addExercise, navigation, startWorkout, template]);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <AppText variant="h1">{template.title}</AppText>
          <AppText variant="body" color="textSecondary">
            {template.description}
          </AppText>
          <AppText variant="label" color="textTertiary">
            {template.estimatedMinutes} min · {template.exercises.length} exercises
          </AppText>
        </View>

        {template.exercises.map(exercise => (
          <Card key={exercise.id}>
            <View style={styles.exerciseRow}>
              <AppText variant="bodyStrong">{exercise.name}</AppText>
              <AppText variant="caption" color="textTertiary">
                {exercise.equipment}
              </AppText>
            </View>
          </Card>
        ))}

        <Button label="Start workout" size="lg" fullWidth onPress={handleStart} />
      </ScrollView>
    </Screen>
  );
};
