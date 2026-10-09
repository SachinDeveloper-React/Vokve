import React, { memo } from 'react';
import type { ChallengeDetail } from '../../types/models';
import { Divider } from '../layout/Divider';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ChallengeParticipantRow } from './ChallengeParticipantRow';

interface Props {
  detail: ChallengeDetail;
}

/**
 * Who is ahead in this challenge, this period.
 *
 * Its own ranking rather than the weekly leaderboard's: a place here is won in
 * the challenge's own metric over the challenge's own period, and borrowing
 * the leaderboard's score would rank a walker by workouts they did in a
 * challenge that never asked for any.
 *
 * The caller's own place is pinned underneath when they are not in the list,
 * so a member outside the top twenty still learns where they stand instead of
 * reading twenty names that are not theirs.
 */
export const ChallengeStandingsCard = memo(({ detail }: Props) => {
  const { standings, me, challenge, ranked } = detail;
  const listed = standings.some(participant => participant.isCurrentUser);

  return (
    <Card radius="xl" padding="base">
      <VStack gap="sm">
        <AppText variant="h3">Challenge Leaderboard</AppText>
        <AppText variant="micro" color="textSecondary">
          {ranked === 0
            ? 'Nobody has made a move yet'
            : `${ranked} taking part so far, ranked by progress this period`}
        </AppText>

        {standings.length === 0 ? (
          <EmptyState
            title="No standings yet"
            message="Ranks appear as soon as people start moving."
          />
        ) : (
          standings.map(participant => (
            <ChallengeParticipantRow
              key={participant.id}
              participant={participant}
              metric={challenge.metric}
              goal={challenge.goal}
            />
          ))
        )}

        {me && !listed ? (
          <>
            <Divider />
            <ChallengeParticipantRow
              participant={me}
              metric={challenge.metric}
              goal={challenge.goal}
            />
          </>
        ) : null}
      </VStack>
    </Card>
  );
});

ChallengeStandingsCard.displayName = 'ChallengeStandingsCard';
