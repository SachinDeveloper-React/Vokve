import React, { memo } from 'react';
import { BarChart3, Check } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { AchievementDetail } from '../../types/models';
import { formatCompactNumber, formatGrouped } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { METRIC_STYLE } from './metrics';

interface Props {
  detail: AchievementDetail;
}

/**
 * How close the member is, in the badge's own unit.
 *
 * The figure is their best on record rather than today's (RULES C7), which is
 * why the label above it says which — "Your best day" against a 10,000-step
 * badge means something quite different from "today", and a bar with no
 * caption would leave the reader to guess.
 *
 * The bar is capped at done. A 10,428-step day against a 10,000 goal is 100%,
 * not 104%: this measures how much of the badge is finished, and nothing is
 * more than finished.
 */
export const AchievementProgressDetailCard = memo(({ detail }: Props) => {
  const { colors } = useTheme();
  const { progress, achievement, unlocked } = detail;
  const tint = colors[METRIC_STYLE[achievement.metric].tint];

  const write = (value: number) =>
    value >= 100_000 ? formatCompactNumber(value) : formatGrouped(value);

  return (
    <Card radius="xl" padding="base">
      <VStack gap="md">
        <HStack align="center" justify="between" gap="sm">
          <HStack align="center" gap="sm">
            <Icon as={BarChart3} size="sm" color="textSecondary" />
            <AppText variant="h3">Your Progress</AppText>
          </HStack>

          <HStack
            align="baseline"
            gap="xxs"
            accessible
            accessibilityLabel={`${progress.label}: ${write(
              progress.value,
            )} of ${write(progress.target)}`}
          >
            <AppText variant="h2">{write(progress.value)}</AppText>
            <AppText variant="micro" color="textSecondary">
              {`/ ${write(progress.target)}`}
            </AppText>
          </HStack>
        </HStack>

        <HStack align="center" gap="sm">
          <VStack flex={1}>
            <ProgressBar progress={progress.percent / 100} tint={tint} />
          </VStack>
          <AppText variant="micro" style={{ color: tint }}>
            {`${progress.percent}%`}
          </AppText>
        </HStack>

        <HStack align="center" gap="xs">
          {unlocked ? (
            <Icon as={Check} size="xs" tint={colors.success} />
          ) : null}
          <AppText
            variant="micro"
            style={unlocked ? { color: colors.success } : undefined}
            color={unlocked ? undefined : 'textSecondary'}
          >
            {progress.caption}
          </AppText>
        </HStack>
      </VStack>
    </Card>
  );
});

AchievementProgressDetailCard.displayName = 'AchievementProgressDetailCard';
