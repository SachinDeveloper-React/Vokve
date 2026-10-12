import React, { memo } from 'react';
import {
  Activity,
  Dumbbell,
  Flame,
  Footprints,
  Droplet,
  Route,
  Timer,
  UtensilsCrossed,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { StreakDayMetric } from '../../types/models';
import { Grid } from '../layout/Grid';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { InfoLabel } from '../wallet/InfoLabel';

/**
 * The glyph for each figure the server sends.
 *
 * A map rather than an icon on the payload: which figures a day carries is
 * the server's call, but what they look like is the app's, and a server that
 * named icons would be choosing from a set it cannot see. An id this build
 * has not met draws the neutral glyph instead of nothing.
 */
const METRIC_ICONS: Record<string, LucideIcon> = {
  steps: Footprints,
  distance: Route,
  activeMinutes: Timer,
  calories: Flame,
  workouts: Dumbbell,
  water: Droplet,
  food: UtensilsCrossed,
};

interface Props {
  metrics: StreakDayMetric[];
}

/** The day's figures, two across, already worded by the server. */
export const StreakDayMetricsCard = memo(({ metrics }: Props) =>
  metrics.length === 0 ? null : (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <InfoLabel label="That Day" emphasis />

        <Grid columns={2} gap="base">
          {metrics.map(metric => (
            <HStack key={metric.id} align="center" gap="sm">
              <Icon
                as={METRIC_ICONS[metric.id] ?? Activity}
                size="sm"
                color="primary"
              />
              <VStack flex={1} gap="xxs">
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {metric.value}
                </AppText>
                <AppText variant="micro" color="textSecondary" numberOfLines={1}>
                  {metric.caption ?? metric.label}
                </AppText>
              </VStack>
            </HStack>
          ))}
        </Grid>
      </VStack>
    </Card>
  ),
);

StreakDayMetricsCard.displayName = 'StreakDayMetricsCard';
