import React, { memo } from 'react';
import {
  Circle,
  Coins,
  Droplet,
  Dumbbell,
  Flame,
  UtensilsCrossed,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { ThemeColors } from '../../constants/colors';
import { useTheme } from '../../theme';
import type { StreakDayEvent } from '../../types/models';
import { formatClockTime, formatCoins } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

type Tint = Extract<
  keyof ThemeColors,
  'primary' | 'success' | 'gold' | 'destructive' | 'textSecondary'
>;

/**
 * How each kind of row is drawn. An unknown kind — a log the server has
 * learned to keep since this build shipped (RULES X2) — draws the dot, which
 * is why the map has a fallback rather than an exhaustive type.
 */
const KINDS: Record<string, { icon: LucideIcon; tint: Tint }> = {
  streak: { icon: Flame, tint: 'success' },
  workout: { icon: Dumbbell, tint: 'primary' },
  coins: { icon: Coins, tint: 'gold' },
  water: { icon: Droplet, tint: 'primary' },
  meal: { icon: UtensilsCrossed, tint: 'primary' },
};

interface Props {
  event: StreakDayEvent;
}

/**
 * One thing that happened on the day: what it was, when, and what it moved.
 *
 * The time is read off the row's own timestamp rather than printed by the
 * server, because it is the only figure on the screen that belongs in the
 * reader's clock rather than in the server's words.
 */
export const StreakDayEventRow = memo(({ event }: Props) => {
  const { colors } = useTheme();
  const { icon, tint } = KINDS[event.kind] ?? {
    icon: Circle,
    tint: 'textSecondary' as Tint,
  };
  const time = event.at === null ? null : formatClockTime(event.at);
  const coins = event.coins;

  return (
    <HStack
      align="center"
      gap="sm"
      py="sm"
      accessible
      accessibilityLabel={[
        event.title,
        event.detail,
        time,
        coins === null || coins === 0
          ? null
          : coins > 0
          ? `${formatCoins(coins)} coins earned`
          : `${formatCoins(-coins)} coins spent`,
      ]
        .filter(Boolean)
        .join('. ')}
    >
      <Icon as={icon} size="xs" tint={colors[tint]} strokeWidth={2.5} />

      <VStack flex={1} gap="xxs">
        <AppText variant="bodyStrong" numberOfLines={1}>
          {event.title}
        </AppText>
        {event.detail === null ? null : (
          <AppText variant="micro" color="textSecondary" numberOfLines={1}>
            {event.detail}
          </AppText>
        )}
      </VStack>

      <VStack align="end" gap="xxs">
        {time === null ? null : (
          <AppText variant="micro" color="textTertiary">
            {time}
          </AppText>
        )}
        {coins === null || coins === 0 ? null : (
          <AppText
            variant="micro"
            style={{ color: coins > 0 ? colors.gold : colors.destructive }}
          >
            {coins > 0
              ? `+${formatCoins(coins)}`
              : `-${formatCoins(-coins)}`}
          </AppText>
        )}
      </VStack>
    </HStack>
  );
});

StreakDayEventRow.displayName = 'StreakDayEventRow';
