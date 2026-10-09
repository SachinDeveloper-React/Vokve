import React, { memo } from 'react';
import { useTheme } from '../../theme';
import type { ChallengeDetail } from '../../types/models';
import { formatCompactNumber, formatGrouped } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ChallengeParticipantRow } from './ChallengeParticipantRow';

interface StatProps {
  label: string;
  value: string;
  tint?: string;
}

const Stat = memo(({ label, value, tint }: StatProps) => (
  <VStack flex={1} align="center" gap="xxs" accessible accessibilityLabel={`${value} ${label}`}>
    <AppText variant="h2" numberOfLines={1} style={tint ? { color: tint } : undefined}>
      {value}
    </AppText>
    <AppText variant="miniMicro" color="textSecondary" center>
      {label}
    </AppText>
  </VStack>
));

Stat.displayName = 'ChallengeParticipantStat';

interface Props {
  detail: ChallengeDetail;
}

/**
 * Who is in the challenge.
 *
 * Everyone is (RULES C5, D-08) — there is no joining and no leaving — so the
 * three figures at the top are the honest answer to "who am I up against":
 * how many members the challenge is open to, how many have moved at all this
 * period, and how many have already finished it.
 *
 * The roster under them carries a bar per member rather than a bare figure,
 * because this tab is read for how close people are, where the leaderboard tab
 * is read for who is ahead.
 */
export const ChallengeParticipantsCard = memo(({ detail }: Props) => {
  const { colors } = useTheme();
  const { challenge, joined, ranked, finished, standings } = detail;

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <VStack gap="xxs">
          <AppText variant="h3">Participants</AppText>
          <AppText variant="micro" color="textSecondary">
            Every VOKVE member is in this challenge — there is nothing to join.
          </AppText>
        </VStack>

        <HStack align="start" gap="sm">
          <Stat label="Joined" value={formatCompactNumber(joined)} />
          <Stat label="Active this period" value={formatGrouped(ranked)} />
          <Stat
            label="Finished"
            value={formatGrouped(finished)}
            tint={colors.success}
          />
        </HStack>

        <Divider />

        {standings.length === 0 ? (
          <EmptyState
            title="Nobody has moved yet"
            message="The first steps of this period will show up here."
          />
        ) : (
          standings.map(participant => (
            <ChallengeParticipantRow
              key={participant.id}
              participant={participant}
              metric={challenge.metric}
              goal={challenge.goal}
              variant="roster"
            />
          ))
        )}
      </VStack>
    </Card>
  );
});

ChallengeParticipantsCard.displayName = 'ChallengeParticipantsCard';
