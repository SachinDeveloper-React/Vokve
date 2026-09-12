import React, { memo } from 'react';
import { ChevronRight } from 'lucide-react-native';
import type { Challenge } from '../../types/models';
import type { IsoDate } from '../../utils/date';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { UpcomingChallengeRow } from './UpcomingChallengeRow';

/** Matches the active card: three rows inline, the rest behind "View All". */
const MAX_ROWS = 3;

interface Props {
  /** Soonest first — the card shows the top of the list, not a sample of it. */
  challenges: Challenge[];
  /** The day the board is showing, which "Starts Tomorrow" is counted from. */
  relativeTo?: IsoDate;
  onPressViewAll: () => void;
}

/**
 * What opens next.
 *
 * Last of the three cards on purpose: it is the only one the user can do
 * nothing about today, and a board that led with challenges nobody can start
 * yet would bury the three bars that are actually moving.
 */
export const UpcomingChallengesCard = memo(
  ({ challenges, relativeTo, onPressViewAll }: Props) => {
    const visible = challenges.slice(0, MAX_ROWS);

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack align="center" justify="between" gap="sm">
            <AppText variant="label" color="textSecondary">
              Upcoming Challenges
            </AppText>

            <Pressable
              onPress={onPressViewAll}
              feedback="opacity"
              accessibilityRole="link"
              accessibilityLabel="View all upcoming challenges"
            >
              <HStack align="center" gap="xxs">
                <AppText variant="micro" color="textSecondary">
                  View All
                </AppText>
                <Icon as={ChevronRight} size="xs" color="textSecondary" />
              </HStack>
            </Pressable>
          </HStack>

          {visible.length === 0 ? (
            <AppText variant="micro" color="textSecondary">
              Nothing scheduled for this period yet.
            </AppText>
          ) : (
            visible.map(challenge => (
              <UpcomingChallengeRow
                key={challenge.id}
                challenge={challenge}
                relativeTo={relativeTo}
              />
            ))
          )}
        </VStack>
      </Card>
    );
  },
);

UpcomingChallengesCard.displayName = 'UpcomingChallengesCard';
