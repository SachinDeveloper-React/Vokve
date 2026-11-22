import React, { memo } from 'react';
import type { CoinGoal, GoalStatus } from '../../utils/coinGoal';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { CoinGoalMeter } from './CoinGoalMeter';

interface Props {
  title: string;
  goal: CoinGoal;
  status: GoalStatus;
  /** A line or an action under the meter — "Track this on Home", say. */
  footer?: React.ReactNode;
}

/**
 * A goal in coins on a page of its own (RULES R20): the product page's
 * "how close am I to this", the basket's "do I have the coins for this
 * order". The figures come from the server — the item's `coinGoal`, the
 * quote's `coinsMin` — and the card only lays them out.
 */
export const CoinProgressCard = memo(
  ({ title, goal, status, footer }: Props) => (
    <Card radius="xl" padding="base">
      <VStack gap="md">
        <AppText variant="h3">{title}</AppText>
        <CoinGoalMeter goal={goal} status={status} />
        {footer ?? null}
      </VStack>
    </Card>
  ),
);

CoinProgressCard.displayName = 'CoinProgressCard';
