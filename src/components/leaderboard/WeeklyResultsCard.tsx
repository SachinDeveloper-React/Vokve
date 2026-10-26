import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { LeaderboardHistory } from '../../types/models';
import { formatDateRange } from '../../utils/date';
import { formatCoins } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';

type Week = LeaderboardHistory['periods'][number];
type State = Week['state'];

/** What each outcome is called, and the colour it is called it in. */
const STATE_LABEL: Record<State, string> = {
  paid: 'Paid',
  held: 'Not paid',
  skipped: 'Under review',
  none: 'No prize',
};

/**
 * One closed week: where the member finished, what the place won, what
 * actually reached their wallet — and, where those differ, why.
 *
 * The figure on the left is the one that was **paid**, because that is the
 * question being asked. A place that won something and paid nothing says so
 * beside it rather than showing a zero and leaving the member to guess
 * whether we kept it.
 */
const WeekRow = memo(({ week }: { week: Week }) => {
  const { colors } = useTheme();
  // Read defensively, and not out of superstition: `state`, `reason`, `won`
  // and `perks` arrived with this card, and a *stored* answer written by the
  // build before it has none of them (`useServerRead` keeps answers past the
  // end of the process and hands them back as they were written — the schema
  // defaults only ever ran on the way in). A row from an older shape must
  // read as a week with nothing to say about itself, never as a crash on the
  // screen that was opened to read it.
  const state: State = week.state ?? 'none';
  const perks = week.perks ?? [];
  const paid = week.state === 'paid' ? week.coins ?? 0 : 0;
  const tint =
    state === 'paid'
      ? colors.success
      : state === 'skipped'
      ? colors.destructive
      : state === 'held'
      ? colors.warning
      : colors.textTertiary;

  return (
    <VStack
      gap="xs"
      py="sm"
      accessible
      accessibilityLabel={`Week of ${formatDateRange(
        week.start,
        week.end,
      )}, rank ${week.rank}. ${STATE_LABEL[state]}. ${week.reason ?? ''}`}
    >
      <HStack align="center" justify="between" gap="sm">
        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={1}>
            {`#${week.rank} · ${formatDateRange(week.start, week.end)}`}
          </AppText>
          <AppText variant="miniMicro" color="textTertiary" numberOfLines={1}>
            {`${week.score.toLocaleString('en-IN')} points`}
          </AppText>
        </VStack>

        <VStack align="end" gap="xxs">
          <AppText
            variant="bodyStrong"
            numberOfLines={1}
            style={{ color: tint }}
          >
            {formatCoins(paid)}
          </AppText>
          <Chip label={STATE_LABEL[state]} tint={tint} />
        </VStack>
      </HStack>

      {week.reason ? (
        <AppText variant="micro" color="textSecondary">
          {week.reason}
        </AppText>
      ) : null}

      {perks.length > 0 ? (
        <AppText variant="miniMicro" color="textTertiary" numberOfLines={1}>
          {`Gear: ${perks.join(' + ')}`}
        </AppText>
      ) : null}
    </VStack>
  );
});

WeekRow.displayName = 'WeekRow';

interface Props {
  history: LeaderboardHistory;
}

/**
 * Week by week: what the member placed, what it paid, and what became of
 * anything it did not.
 *
 * The screen above this one answers "what can I win"; this answers the two
 * questions that follow it and had no home at all — **did I get the coins**,
 * and **does a place I won once pay again**. The second is answered by the
 * list simply existing: every week is its own row with its own prize, which
 * is what "each week is paid on its own" looks like.
 *
 * Nothing here is computed in the app. The state and the sentence under each
 * week are the server's (⚙ `leaderboard.outcomes`), because a reason the app
 * wrote could disagree with what was actually paid.
 */
export const WeeklyResultsCard = memo(({ history }: Props) => {
  const { colors } = useTheme();
  const weeks = history.periods;

  return (
    <Card radius="xl" padding="base">
      <VStack gap="sm">
        <HStack align="center" gap="sm">
          <Emoji size="sm">🧾</Emoji>
          <VStack flex={1} gap="xxs">
            <AppText variant="h3" numberOfLines={1}>
              Your Weeks
            </AppText>
            <AppText variant="miniMicro" color="textSecondary">
              Every week is paid on its own — place first again and the prize is
              paid again.
            </AppText>
          </VStack>
        </HStack>

        {weeks.length === 0 ? (
          <AppText variant="micro" color="textSecondary">
            No week has closed with you on the board yet. Walk, train or finish
            a challenge and your first place is recorded on Monday.
          </AppText>
        ) : (
          <VStack>
            {weeks.map((week, index) => (
              <React.Fragment key={week.id}>
                {index > 0 ? <Divider /> : null}
                <WeekRow week={week} />
              </React.Fragment>
            ))}
          </VStack>
        )}

        {(history.rewardCoinsHeld ?? 0) > 0 ? (
          <HStack align="center" gap="xs" style={styles.note}>
            <Icon as={Info} size="xs" tint={colors.warning} />
            <AppText
              variant="miniMicro"
              color="textSecondary"
              style={styles.line}
            >
              {`${formatCoins(
                history.rewardCoinsHeld,
              )} of prizes were won and not paid${
                history.prizesRunning
                  ? '.'
                  : ' — leaderboard prizes are not running yet.'
              }`}
            </AppText>
          </HStack>
        ) : null}
      </VStack>
    </Card>
  );
});

WeeklyResultsCard.displayName = 'WeeklyResultsCard';

const styles = StyleSheet.create({
  note: { paddingTop: 2 },
  line: { flex: 1 },
});
