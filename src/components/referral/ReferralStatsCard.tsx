import React, { memo } from 'react';
import { Coins, Hourglass, UserPlus } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { formatCoins } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';

interface FigureProps {
  icon: LucideIcon;
  tint: string;
  value: string;
  label: string;
  caption: string;
}

const Figure = memo(({ icon, tint, value, label, caption }: FigureProps) => (
  <VStack
    flex={1}
    gap="xs"
    accessible
    accessibilityLabel={`${label}, ${value}. ${caption}`}
  >
    <IconBadge icon={icon} tint={tint} size={30} />

    <VStack gap="none">
      <AppText variant="h2" numberOfLines={1}>
        {value}
      </AppText>
      <AppText variant="miniMicro" numberOfLines={2}>
        {label}
      </AppText>
      <AppText variant="miniMicro" numberOfLines={1} style={{ color: tint }}>
        {caption}
      </AppText>
    </VStack>
  </VStack>
));

Figure.displayName = 'Figure';

interface Props {
  successful: number;
  pending: number;
  coinsEarned: number;
}

/**
 * What the code has done so far, in three figures.
 *
 * Counted from the referral list rather than stated beside it, so the number
 * of friends and the coins they earned cannot disagree with the rows under
 * them — and "pending" is a count of its own, because a friend who has
 * installed and not yet verified is neither a reward nor nothing.
 */
export const ReferralStatsCard = memo(
  ({ successful, pending, coinsEarned }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="xl" padding="base">
        <HStack align="start" gap="sm">
          <Figure
            icon={UserPlus}
            tint={colors.success}
            value={String(successful)}
            label="Successful Referrals"
            caption="Friends joined"
          />
          <Figure
            icon={Hourglass}
            tint={colors.gold}
            value={String(pending)}
            label="Pending"
            caption="Verification"
          />
          <Figure
            icon={Coins}
            tint={colors.avatarPurple}
            value={formatCoins(coinsEarned)}
            label="Coins Earned"
            caption="Total Rewards"
          />
        </HStack>
      </Card>
    );
  },
);

ReferralStatsCard.displayName = 'ReferralStatsCard';
