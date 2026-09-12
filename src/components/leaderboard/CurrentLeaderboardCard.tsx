import React, { Fragment, memo } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { LeaderboardEntry } from '../../types/models';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { Pressable } from '../form/Pressable';
import { LeaderboardEntryRow } from './LeaderboardEntryRow';

/**
 * Written out rather than built from `period`: "This Week's top performers"
 * shouts the middle of its own sentence, and the line reads as a caption on
 * the card whatever period the chip beside it names.
 */
const SUBTITLE = "This week's top performers & their rewards";

interface Props {
  /** In rank order. The card shows the top of the board, not a sample of it. */
  entries: LeaderboardEntry[];
  /** The period the board covers — "This Week". */
  period?: string;
  onPressViewFull: () => void;
}

/**
 * Who is winning, and what it is paying them.
 *
 * Directly under the tier table on purpose: the table says a first place is
 * worth 5,000 coins, and this says who is holding it — the abstract rule and
 * the person it is currently about, in that order.
 */
export const CurrentLeaderboardCard = memo(
  ({ entries, period = 'This Week', onPressViewFull }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack align="center" justify="between" gap="sm">
            <VStack flex={1} gap="xxs">
              <HStack align="center" gap="sm">
                <Emoji size="sm">👑</Emoji>
                <AppText variant="h3" numberOfLines={1} style={styles.title}>
                  Current Leaderboard Rewards
                </AppText>
              </HStack>
              <AppText variant="micro" color="textSecondary" numberOfLines={1}>
                {SUBTITLE}
              </AppText>
            </VStack>

            <Chip label={period} tint={colors.textSecondary} />
          </HStack>

          <VStack>
            {entries.map((entry, index) => (
              <Fragment key={entry.id}>
                {index > 0 ? <Divider /> : null}
                <LeaderboardEntryRow entry={entry} />
              </Fragment>
            ))}
          </VStack>

          <Pressable
            onPress={onPressViewFull}
            feedback="opacity"
            accessibilityRole="link"
            accessibilityLabel="View full leaderboard"
          >
            <HStack align="center" justify="center" gap="xxs">
              <AppText variant="micro" color="primary">
                View Full Leaderboard
              </AppText>
              <Icon as={ChevronRight} size="xs" tint={colors.primary} />
            </HStack>
          </Pressable>
        </VStack>
      </Card>
    );
  },
);

CurrentLeaderboardCard.displayName = 'CurrentLeaderboardCard';

/**
 * Text in a row does not shrink by default, so a title wider than the column
 * it is given runs past the edge — under the period chip beside it — instead
 * of truncating. Letting it shrink is what makes `numberOfLines` bite.
 */
const styles = StyleSheet.create({
  title: { flexShrink: 1 },
});
