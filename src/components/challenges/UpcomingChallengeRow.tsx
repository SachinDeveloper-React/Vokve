import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { CalendarDays } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { Challenge } from '../../types/models';
import { withAlpha } from '../../utils/color';
import {
  daysBetween,
  formatLongDate,
  todayIso,
  type IsoDate,
} from '../../utils/date';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { CoinAmount } from '../wallet/CoinAmount';
import { METRIC_STYLE } from './metrics';

const DISC_SIZE = moderateScale(40);

/**
 * "Starts Tomorrow", or the date itself.
 *
 * Only the next two days get a word. Past that, "in 9 days" is a sum the user
 * has to redo every time they open the screen, where a date is something they
 * can hold against their own week.
 *
 * Counted from the day the board is anchored to rather than from today: the
 * user can move that day, and a challenge that opens the morning after the
 * chosen one is "tomorrow" from where they are looking.
 */
export function formatStartLabel(
  startsAt: string,
  relativeTo: IsoDate = todayIso(),
): string {
  const days = daysBetween(relativeTo, startsAt);

  if (days <= 0) return 'Starts Today';
  if (days === 1) return 'Starts Tomorrow';
  return `Starts ${formatLongDate(startsAt)}`;
}

interface Props {
  challenge: Challenge;
  /** The day the board is showing. Defaults to today. */
  relativeTo?: IsoDate;
}

/**
 * One challenge that has not opened yet: what it is, when it starts, and what
 * it pays.
 *
 * No progress bar, deliberately. A challenge with nothing done yet would draw
 * an empty track down every row, which reads as "you are failing at four
 * things" rather than "these are next".
 */
export const UpcomingChallengeRow = memo(({ challenge, relativeTo }: Props) => {
  const { colors, isDark } = useTheme();
  const tint = colors[METRIC_STYLE[challenge.metric].tint];
  const starts = challenge.startsAt
    ? formatStartLabel(challenge.startsAt, relativeTo)
    : '';

  return (
    <HStack
      align="center"
      gap="md"
      accessible
      accessibilityLabel={`${challenge.title}. ${challenge.description}. ${starts}. Pays ${challenge.rewardCoins} coins`}
    >
      <View
        style={[
          styles.disc,
          { backgroundColor: withAlpha(tint, isDark ? 0.22 : 0.12) },
        ]}
      >
        <Emoji size="sm">{challenge.emoji}</Emoji>
      </View>

      <VStack flex={1} gap="xxs">
        <AppText variant="bodyStrong" numberOfLines={1}>
          {challenge.title}
        </AppText>
        <AppText variant="micro" color="textSecondary" numberOfLines={2}>
          {challenge.description}
        </AppText>
      </VStack>

      <VStack align="end" gap="xxs">
        <HStack align="center" gap="xxs">
          <Icon as={CalendarDays} size="xs" tint={colors.brandAccent} />
          <AppText
            variant="miniMicro"
            numberOfLines={1}
            style={{ color: colors.brandAccent }}
          >
            {starts}
          </AppText>
        </HStack>

        <CoinAmount amount={challenge.rewardCoins} size="sm" withUnit />
      </VStack>
    </HStack>
  );
});

UpcomingChallengeRow.displayName = 'UpcomingChallengeRow';

const styles = StyleSheet.create({
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
