import React, { memo } from 'react';
import { Trophy } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { Achievement } from '../../types/models';
import { formatRelativeDay } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';
import { ProgressBar } from '../ui/ProgressBar';

interface Props {
  achievements: Achievement[];
}

/**
 * How much of the shelf is filled, and what filled it last.
 *
 * The figure at the top of the screen rather than a count hidden in the
 * header: a shelf of twenty rings tells you nothing about how you are doing
 * until you have counted the coloured ones yourself.
 *
 * The newest unlock is named underneath because it is the one piece of the
 * shelf that answers "am I still getting anywhere" — a bar at 12 of 20 reads
 * the same whether the last badge landed yesterday or in March.
 */
export const AchievementProgressCard = memo(({ achievements }: Props) => {
  const { colors } = useTheme();
  const earned = achievements.filter(a => a.achievedAt !== null);

  // Newest first by the date the server gave, not by catalogue order.
  const newest = earned.reduce<Achievement | null>(
    (latest, badge) =>
      latest === null || (badge.achievedAt ?? '') > (latest.achievedAt ?? '')
        ? badge
        : latest,
    null,
  );

  const share =
    achievements.length > 0 ? earned.length / achievements.length : 0;

  return (
    <Card radius="xl" padding="base">
      <VStack gap="md">
        <HStack align="center" gap="md">
          <IconBadge icon={Trophy} tint={colors.gold} size="md" />

          <VStack flex={1} gap="xxs">
            <AppText variant="h2">
              {`${earned.length} of ${achievements.length} unlocked`}
            </AppText>
            <AppText variant="micro" color="textSecondary" numberOfLines={2}>
              {newest
                ? `Latest: ${newest.label} · ${formatRelativeDay(
                    newest.achievedAt!,
                  )}`
                : 'Walk, train and finish challenges to start filling the shelf.'}
            </AppText>
          </VStack>
        </HStack>

        <ProgressBar progress={share} tint={colors.gold} />
      </VStack>
    </Card>
  );
});

AchievementProgressCard.displayName = 'AchievementProgressCard';
