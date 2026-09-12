import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../../constants/colors';
import { radius, useTheme } from '../../theme';
import { formatCoins } from '../../utils/format';
import { withAlpha } from '../../utils/color';
import { Divider } from '../layout/Divider';
import { VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import { CoinAmount } from '../wallet/CoinAmount';

export type TierTint = Extract<
  keyof ThemeColors,
  'gold' | 'textSecondary' | 'brandAccent'
>;

export interface RewardTier {
  id: string;
  /** The medal above the card — 🥇, 🥈, 🥉. */
  medal: string;
  /** The places this tier covers — "Rank 1", "Rank 2 – 3". */
  label: string;
  coins: number;
  /** The gear on top of the coins, one line each. */
  perks: string[];
  /** Which board the rank is counted on. */
  scope: string;
  tint: TierTint;
}

interface Props {
  tier: RewardTier;
}

/**
 * One rung of the reward ladder.
 *
 * The medal sits above the card rather than inside it, so the three read as a
 * podium at a glance — which is the one thing about this table a user should
 * not have to read words to understand.
 *
 * The coins are the figure the card is built around and the perks are listed
 * under them in the tier's own colour, because the difference between the
 * rungs is what the user is here to compare.
 */
export const RewardTierCard = memo(({ tier }: Props) => {
  const { colors, isDark } = useTheme();
  const tint = colors[tier.tint];

  return (
    <VStack
      flex={1}
      align="center"
      gap="xs"
      accessible
      accessibilityLabel={`${tier.label}, ${formatCoins(tier.coins)} coins${
        tier.perks.length > 0 ? `, plus ${tier.perks.join(' and ')}` : ''
      }, ${tier.scope}`}
    >
      <Emoji size="md">{tier.medal}</Emoji>

      <VStack
        flex={1}
        gap="xs"
        p="md"
        style={[
          styles.card,
          {
            backgroundColor: withAlpha(tint, isDark ? 0.16 : 0.09),
            borderColor: withAlpha(tint, isDark ? 0.34 : 0.22),
          },
        ]}
      >
        <AppText variant="bodyStrong" numberOfLines={1}>
          {tier.label}
        </AppText>

        <CoinAmount amount={tier.coins} size="sm" tint={tint} withUnit />

        <VStack gap="none">
          {tier.perks.map(perk => (
            <AppText
              key={perk}
              variant="miniMicro"
              color="textSecondary"
              numberOfLines={1}
            >
              {`+ ${perk}`}
            </AppText>
          ))}
        </VStack>

        <Divider />

        <AppText variant="miniMicro" color="textTertiary" numberOfLines={1}>
          {tier.scope}
        </AppText>
      </VStack>
    </VStack>
  );
});

RewardTierCard.displayName = 'RewardTierCard';

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
