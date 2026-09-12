import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../../constants/colors';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { LeaderboardEntry } from '../../types/models';
import { formatCoins } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Avatar } from '../media/Avatar';
import { AppText } from '../ui/AppText';
import { Chip } from '../ui/Chip';
import { CoinAmount } from '../wallet/CoinAmount';

type RankTint = Extract<
  keyof ThemeColors,
  'gold' | 'textSecondary' | 'brandAccent' | 'textTertiary'
>;

/**
 * The podium's three colours, and a neutral for everyone below it.
 *
 * The same three the reward tiers are drawn in, so a row's number and the rung
 * it pays out of are recognisably the same thing.
 */
function rankTint(rank: number): RankTint {
  if (rank === 1) return 'gold';
  if (rank === 2) return 'textSecondary';
  if (rank === 3) return 'brandAccent';
  return 'textTertiary';
}

interface Props {
  entry: LeaderboardEntry;
}

/**
 * One place on this week's board.
 *
 * The rank is stated twice — as the number down the left and as the pill on
 * the right — because they answer different questions: the column is how the
 * list is ordered, the pill is which reward tier that place falls in.
 */
export const LeaderboardEntryRow = memo(({ entry }: Props) => {
  const { colors } = useTheme();

  return (
    <HStack
      align="center"
      gap="sm"
      py="sm"
      accessible
      accessibilityLabel={`Rank ${entry.rank}, ${entry.name}, ${
        entry.location
      }, ${formatCoins(entry.coins)} coins${
        entry.perk ? ` plus ${entry.perk}` : ''
      }`}
    >
      <AppText
        variant="bodyStrong"
        style={[styles.rank, { color: colors[rankTint(entry.rank)] }]}
      >
        {entry.rank}
      </AppText>

      <Avatar name={entry.name} uri={entry.avatarUrl} size="sm" />

      <VStack flex={1} gap="xxs">
        <AppText variant="bodyStrong" numberOfLines={1}>
          {entry.name}
        </AppText>
        <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
          {entry.location}
        </AppText>
      </VStack>

      <VStack align="end" gap="xxs">
        <CoinAmount amount={entry.coins} size="sm" />
        {entry.perk ? (
          <AppText variant="miniMicro" color="textTertiary" numberOfLines={1}>
            {`+ ${entry.perk}`}
          </AppText>
        ) : null}
      </VStack>

      <Chip label={`Rank ${entry.rank}`} tint={colors.success} />
    </HStack>
  );
});

LeaderboardEntryRow.displayName = 'LeaderboardEntryRow';

/** A fixed column so the names line up however wide the numbers get. */
const styles = StyleSheet.create({
  rank: { width: moderateScale(14), textAlign: 'center' },
});
