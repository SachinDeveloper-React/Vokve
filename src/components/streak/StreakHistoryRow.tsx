import React, { memo } from 'react';
import { Check, RotateCcw, Snowflake, X } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { ThemeColors } from '../../constants/colors';
import { useTheme } from '../../theme';
import type { StreakHistoryDay, StreakHistoryStatus } from '../../types/models';
import { formatLongDate } from '../../utils/date';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

type Tint = Extract<
  keyof ThemeColors,
  'success' | 'destructive' | 'primary' | 'gold'
>;

/** How each kind of day is marked and worded. */
const STATUS: Record<
  StreakHistoryStatus,
  { icon: LucideIcon; tint: Tint; label: string }
> = {
  completed: { icon: Check, tint: 'success', label: 'Completed' },
  frozen: { icon: Snowflake, tint: 'primary', label: 'Frozen' },
  restored: { icon: RotateCcw, tint: 'gold', label: 'Restored' },
  missed: { icon: X, tint: 'destructive', label: 'Missed' },
};

interface Props {
  entry: StreakHistoryDay;
}

/**
 * One day on the record: how it went, when it was, and what carried it.
 *
 * Four states rather than two. A frozen day and a restored one both kept the
 * run alive, but neither was walked, and a row that drew them as completed
 * would let a member believe they had earned a streak they had paid for.
 *
 * The detail on the right is the server's wording — the steps on the day, or
 * what a restore cost — because the cost of a restore is the ledger's to
 * report, not something the app should reconstruct from a price list.
 */
export const StreakHistoryRow = memo(({ entry }: Props) => {
  const { colors } = useTheme();
  const { icon, tint, label } = STATUS[entry.status];
  const date = formatLongDate(entry.date);

  return (
    <HStack
      align="center"
      gap="sm"
      py="sm"
      accessible
      accessibilityLabel={`${
        entry.day === null ? date : `Day ${entry.day}, ${date}`
      }, ${label}. ${entry.detail}`}
    >
      <Icon as={icon} size="xs" tint={colors[tint]} strokeWidth={3} />

      <VStack flex={1} gap="xxs">
        <HStack align="center" gap="xs" wrap>
          {entry.day === null ? null : (
            <AppText variant="bodyStrong">{`Day ${entry.day}`}</AppText>
          )}
          <AppText variant="micro" style={{ color: colors[tint] }}>
            {label}
          </AppText>
        </HStack>
      </VStack>

      <AppText variant="micro" color="textSecondary" numberOfLines={1}>
        {date}
      </AppText>

      <AppText
        variant="micro"
        numberOfLines={1}
        style={
          entry.status === 'restored' ? { color: colors.gold } : undefined
        }
        color={entry.status === 'restored' ? undefined : 'textTertiary'}
      >
        {entry.detail}
      </AppText>
    </HStack>
  );
});

StreakHistoryRow.displayName = 'StreakHistoryRow';
