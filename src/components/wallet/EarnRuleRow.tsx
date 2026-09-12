import React, { memo } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import { CoinAmount } from './CoinAmount';

interface Props {
  icon: LucideIcon;
  /** Icon colour, and the wash behind it. Pass a theme colour, not a literal. */
  tint: string;
  title: string;
  /** What the user has to do — "per 1 000 steps". */
  detail: string;
  /** Coins the rule pays out. */
  reward: number;
}

/**
 * One line in the "ways to earn" list: what pays, and how much.
 *
 * Deliberately not pressable. The rules are a rate card, not a set of
 * shortcuts — a row that looked tappable and did nothing would read as broken,
 * and the actions themselves already live on the Home screen.
 */
export const EarnRuleRow = memo(({ icon, tint, title, detail, reward }: Props) => (
  <HStack align="center" gap="md">
    <IconBadge icon={icon} tint={tint} size="sm" />

    <VStack flex={1} gap="xxs">
      <AppText variant="bodyStrong">{title}</AppText>
      <AppText variant="caption" color="textSecondary">
        {detail}
      </AppText>
    </VStack>

    <CoinAmount amount={reward} size="md" signed />
  </HStack>
));

EarnRuleRow.displayName = 'EarnRuleRow';
