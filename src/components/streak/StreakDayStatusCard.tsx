import React, { memo } from 'react';
import {
  Check,
  Clock,
  Coins,
  RotateCcw,
  Snowflake,
  X,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { ThemeColors } from '../../constants/colors';
import { useTheme } from '../../theme';
import type { StreakDayDetail, StreakDayStatus } from '../../types/models';
import { formatCoins, formatGrouped } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { IconBadge } from '../ui/IconBadge';
import { ProgressBar } from '../ui/ProgressBar';

type Tint = Extract<
  keyof ThemeColors,
  'success' | 'destructive' | 'primary' | 'gold' | 'textTertiary'
>;

/** How each state of a day is marked and named. */
const STATUS: Record<
  StreakDayStatus,
  { icon: LucideIcon; tint: Tint; label: string }
> = {
  completed: { icon: Check, tint: 'success', label: 'Completed' },
  frozen: { icon: Snowflake, tint: 'primary', label: 'Frozen' },
  restored: { icon: RotateCcw, tint: 'gold', label: 'Restored' },
  missed: { icon: X, tint: 'destructive', label: 'Missed' },
  upcoming: { icon: Clock, tint: 'textTertiary', label: 'Upcoming' },
};

interface Props {
  day: StreakDayDetail;
}

/**
 * How the day went, at the top of its own screen: the state, the server's
 * headline and line, the steps against the goal they were read against, and
 * whatever is still open about the day.
 *
 * Every word here is the server's. What counted the day is config and what a
 * restore cost is the ledger's, so a card that worded its own verdict would
 * be guessing at both — and could disagree with the row the user tapped to
 * get here.
 */
export const StreakDayStatusCard = memo(({ day }: Props) => {
  const { colors } = useTheme();
  const { icon, tint, label } = STATUS[day.status];

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <HStack align="center" gap="sm">
          <IconBadge icon={icon} tint={colors[tint]} size="md" />

          <VStack flex={1} gap="xxs">
            <AppText variant="h3">{day.title}</AppText>
            <AppText variant="caption" color="textSecondary">
              {day.detail}
            </AppText>
          </VStack>

          <Chip label={label} tint={colors[tint]} />
        </HStack>

        {day.status === 'upcoming' ? null : (
          <VStack gap="xs">
            <HStack align="center" justify="between" gap="sm">
              <AppText variant="micro" color="textSecondary">
                Steps
              </AppText>
              <AppText variant="micro">
                {`${formatGrouped(day.steps)} / ${formatGrouped(
                  day.stepGoal,
                )}`}
              </AppText>
            </HStack>

            <ProgressBar
              progress={day.stepGoal === 0 ? 0 : day.steps / day.stepGoal}
              tint={day.goalMet ? colors.success : colors.primary}
            />

            {/* Unverified steps never earn a day (RULES S9), so a day that
                walked the distance and still did not count has to say why. */}
            {day.steps > 0 && !day.verified ? (
              <AppText variant="micro" color="textTertiary">
                These steps have not been verified.
              </AppText>
            ) : null}
          </VStack>
        )}

        {day.coinsEarned === 0 ? null : (
          <HStack align="center" gap="xs">
            <Icon as={Coins} size="xs" tint={colors.gold} />
            <AppText variant="micro" style={{ color: colors.gold }}>
              {day.coinsEarned > 0
                ? `${formatCoins(day.coinsEarned)} coins earned`
                : `${formatCoins(-day.coinsEarned)} coins spent`}
            </AppText>
          </HStack>
        )}

        {day.note === null ? null : (
          <AppText variant="caption" color="textSecondary">
            {day.note}
          </AppText>
        )}
      </VStack>
    </Card>
  );
});

StreakDayStatusCard.displayName = 'StreakDayStatusCard';
