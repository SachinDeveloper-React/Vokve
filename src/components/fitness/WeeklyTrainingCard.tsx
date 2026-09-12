import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '../../theme';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { Divider } from '../layout/Divider';

interface Figure {
  label: string;
  value: string;
  unit?: string;
}

interface Props {
  completed: number;
  goal: number;
  figures: Figure[];
}

/**
 * The week's training at a glance, under the daily step sections.
 *
 * A bar rather than a ring: the step goal above already owns the ring, and two
 * rings on one screen read as two headlines competing rather than a hierarchy.
 */
export const WeeklyTrainingCard = memo(
  ({ completed, goal, figures }: Props) => {
    const safeGoal = Math.max(1, goal);

    return (
      <Card elevation="low" style={styles.card}>
        <View style={styles.header}>
          <AppText variant="label" color="textSecondary">
            This week
          </AppText>
          <AppText variant="micro" color="textTertiary">
            {`${completed} of ${goal} workouts`}
          </AppText>
        </View>

        <ProgressBar progress={completed / safeGoal} />

        <View style={styles.figures}>
          {figures.map((figure, index) => (
            <React.Fragment key={figure.label}>
              {index > 0 ? <Divider orientation="vertical" /> : null}
              <View style={styles.figure}>
                <AppText variant="h3">
                  {figure.value}
                  {figure.unit ? (
                    <AppText variant="micro" color="textTertiary">
                      {` ${figure.unit}`}
                    </AppText>
                  ) : null}
                </AppText>
                <AppText variant="micro" color="textTertiary">
                  {figure.label}
                </AppText>
              </View>
            </React.Fragment>
          ))}
        </View>
      </Card>
    );
  },
);

WeeklyTrainingCard.displayName = 'WeeklyTrainingCard';

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  figures: { flexDirection: 'row', alignItems: 'center' },
  figure: { flex: 1, alignItems: 'center', gap: spacing.xxs },
});
