import React, { memo } from 'react';
import { Dumbbell, Flame, Footprints, Users } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { Divider } from '../layout/Divider';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { EarnRuleRow } from './EarnRuleRow';

/**
 * The rate card the wallet shows under the balance.
 *
 * Kept next to the ledger on purpose: the ledger says what the user earned,
 * this says how to earn more, and a user who has just seen a small balance is
 * exactly the one looking for the second answer.
 */
export const EarnCoinsCard = memo(() => {
  const { colors } = useTheme();

  return (
    <Card radius="xl">
      <VStack gap="base">
        <AppText variant="label" color="textTertiary">
          Ways to earn
        </AppText>

        <EarnRuleRow
          icon={Footprints}
          tint={colors.primary}
          title="Walk"
          detail="Per 1,000 steps"
          reward={10}
        />
        <Divider />

        <EarnRuleRow
          icon={Dumbbell}
          tint={colors.avatarPurple}
          title="Finish a workout"
          detail="Any logged session"
          reward={100}
        />
        <Divider />

        <EarnRuleRow
          icon={Flame}
          tint={colors.brandAccent}
          title="Keep a streak"
          detail="Every 7 days in a row"
          reward={175}
        />
        <Divider />

        <EarnRuleRow
          icon={Users}
          tint={colors.success}
          title="Invite a friend"
          detail="Once they log a workout"
          reward={300}
        />
      </VStack>
    </Card>
  );
});

EarnCoinsCard.displayName = 'EarnCoinsCard';
