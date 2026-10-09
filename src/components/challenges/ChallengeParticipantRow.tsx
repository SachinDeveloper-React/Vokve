import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../../constants/colors';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { ChallengeMetric, ChallengeParticipant } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Avatar } from '../media/Avatar';
import { AppText } from '../ui/AppText';
import { Chip } from '../ui/Chip';
import { ProgressBar } from '../ui/ProgressBar';
import { METRIC_STYLE, formatProgress } from './metrics';

type RankTint = Extract<
  keyof ThemeColors,
  'gold' | 'textSecondary' | 'brandAccent' | 'textTertiary'
>;

/**
 * The podium's three colours, and a neutral below it — the same three the
 * leaderboard's rows use, so a rank means the same thing on both screens.
 */
function rankTint(rank: number): RankTint {
  if (rank === 1) return 'gold';
  if (rank === 2) return 'textSecondary';
  if (rank === 3) return 'brandAccent';
  return 'textTertiary';
}

interface Props {
  participant: ChallengeParticipant;
  metric: ChallengeMetric;
  goal: number;
  /**
   * `roster` adds the bar showing how far the member is through the goal.
   * `ranking` leaves it off: a list sorted by progress already draws that
   * shape down the column of figures, and a second one repeats it.
   */
  variant?: 'ranking' | 'roster';
}

/** One member's place in a challenge, in the challenge's own metric. */
export const ChallengeParticipantRow = memo(
  ({ participant, metric, goal, variant = 'ranking' }: Props) => {
    const { colors } = useTheme();
    const tint = colors[METRIC_STYLE[metric].tint];
    const name = participant.isCurrentUser
      ? `${participant.name} (you)`
      : participant.name;

    return (
      <HStack
        align="center"
        gap="sm"
        py="sm"
        accessible
        accessibilityLabel={`Rank ${participant.rank}, ${name}, ${formatProgress(
          participant.progress,
          goal,
          metric,
        )}${participant.completed ? ', completed' : ''}`}
      >
        <AppText
          variant="bodyStrong"
          style={[styles.rank, { color: colors[rankTint(participant.rank)] }]}
        >
          {participant.rank}
        </AppText>

        <Avatar name={participant.name} uri={participant.avatarUrl} size="sm" />

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={1}>
            {name}
          </AppText>
          <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
            {formatProgress(participant.progress, goal, metric)}
          </AppText>
          {variant === 'roster' ? (
            <ProgressBar
              progress={goal > 0 ? participant.progress / goal : 0}
              tint={tint}
              height={moderateScale(4)}
            />
          ) : null}
        </VStack>

        {participant.completed ? (
          <Chip label="Done" tint={colors.success} />
        ) : null}
      </HStack>
    );
  },
);

ChallengeParticipantRow.displayName = 'ChallengeParticipantRow';

/** A fixed column so the names line up however wide the numbers get. */
const styles = StyleSheet.create({
  rank: { width: moderateScale(16), textAlign: 'center' },
});
