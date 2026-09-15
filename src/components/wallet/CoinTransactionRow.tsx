import React, { memo } from 'react';
import {
  Dumbbell,
  Flame,
  Footprints,
  Gift,
  ShoppingBag,
  Trophy,
  Undo2,
  type LucideIcon,
} from 'lucide-react-native';
import { useTheme, type ThemeColors } from '../../theme';
import { formatClockTime, formatRelativeDay } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import type { CoinSource, CoinTransaction } from '../../types/models';
import { CoinAmount } from './CoinAmount';

export type CoinSourceTint = Extract<
  keyof ThemeColors,
  | 'primary'
  | 'avatarPurple'
  | 'brandAccent'
  | 'gold'
  | 'success'
  | 'textSecondary'
>;

/**
 * Icon and colour per source, in one place. A ledger row is identified by its
 * glyph before its text is read, so the mapping has to be exhaustive — adding
 * a `CoinSource` without an entry here is a type error rather than a row that
 * renders with no icon.
 *
 * Exported so the history's filter chips carry the same glyph as the rows
 * they filter to: a chip and a row that disagreed about what "streak" looks
 * like would make the filter feel like it had picked the wrong thing.
 */
export const COIN_SOURCE_STYLE: Record<
  CoinSource,
  { icon: LucideIcon; tint: CoinSourceTint }
> = {
  steps: { icon: Footprints, tint: 'primary' },
  workout: { icon: Dumbbell, tint: 'avatarPurple' },
  streak: { icon: Flame, tint: 'brandAccent' },
  challenge: { icon: Trophy, tint: 'gold' },
  referral: { icon: Gift, tint: 'success' },
  purchase: { icon: ShoppingBag, tint: 'textSecondary' },
  refund: { icon: Undo2, tint: 'textSecondary' },
};

interface Props {
  transaction: CoinTransaction;
  /**
   * What the line under the title says about when. `'day'` — "Today",
   * "Yesterday" — for a row standing on its own in the wallet; `'time'` for a
   * row already filed under a day heading in the history, where repeating
   * the day would say nothing and the clock time is what is left to say.
   */
  when?: 'day' | 'time';
}

/**
 * One movement in the coin ledger.
 *
 * Green for a credit and red for a debit, but never only that: the amount
 * carries its own `+` or `-`, so the direction survives for a reader who
 * cannot tell the two colours apart.
 */
export const CoinTransactionRow = memo(
  ({ transaction, when = 'day' }: Props) => {
    const { colors } = useTheme();
    const { icon, tint } = COIN_SOURCE_STYLE[transaction.source];
    const isCredit = transaction.amount > 0;
    const subtitle =
      when === 'time'
        ? formatClockTime(transaction.createdAt)
        : formatRelativeDay(transaction.createdAt);

    return (
      <HStack align="center" gap="md" py="sm">
        <IconBadge icon={icon} tint={colors[tint]} size={26} variant="muted" />

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={1}>
            {transaction.title}
          </AppText>
          <AppText variant="micro" color="textTertiary" numberOfLines={1}>
            {subtitle}
          </AppText>
        </VStack>

        <CoinAmount
          amount={transaction.amount}
          size="md"
          signed
          tint={isCredit ? colors.success : colors.destructive}
        />
      </HStack>
    );
  },
);

CoinTransactionRow.displayName = 'CoinTransactionRow';
