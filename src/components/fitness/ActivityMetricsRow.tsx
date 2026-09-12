import React, { memo } from 'react';
import { ChartColumnBig, Flame, MapPin, Timer } from 'lucide-react-native';
import { Grid } from '../layout/Grid';
import { useTheme } from '../../theme';
import { MetricTile } from './MetricTile';

interface Props {
  distanceKm: number;
  activeMinutes: number;
  caloriesBurned: number;
  onPressAnalysis?: () => void;
}

/**
 * The four-up summary under the step goal.
 *
 * Two columns rather than four across: at four, each tile is under 90pt wide on
 * a small phone and the values start wrapping mid-number. The grid widens on a
 * tablet where there is room for a single row.
 */
export const ActivityMetricsRow = memo(
  ({ distanceKm, activeMinutes, caloriesBurned, onPressAnalysis }: Props) => {
    const { colors } = useTheme();

    return (
      <Grid columns={{ compact: 4, expanded: 4 }} gap="md">
        <MetricTile
          icon={MapPin}
          label="Distance"
          value={`${distanceKm.toFixed(1)} km`}
          tint={colors.avatarPrimary}
        />
        <MetricTile
          icon={Timer}
          label="Time"
          value={`${activeMinutes} min`}
          tint={colors.avatarPurple}
        />
        <MetricTile
          icon={Flame}
          label="Calories"
          value={`${Math.round(caloriesBurned)} kcal`}
          tint={colors.avatarOrange}
        />
        <MetricTile
          icon={ChartColumnBig}
          label="Analysis"
          value="View"
          tint={colors.avatarCyan}
          onPress={onPressAnalysis}
        />
      </Grid>
    );
  },
);

ActivityMetricsRow.displayName = 'ActivityMetricsRow';
