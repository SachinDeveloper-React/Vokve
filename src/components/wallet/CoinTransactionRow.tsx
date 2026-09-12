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
import { formatRelativeDay } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import type { CoinSource, CoinTransaction } from '../../types/models';
import { CoinAmount } from './CoinAmount';

type Tint = Extract<
  keyof ThemeColors,
  'primary' | 'avatarPurple' | 'brandAccent' | 'gold' | 'success' | 'textSecondary'
>;

/**
 * Icon and colour per source, in one place. A ledger row is identified by its
 * glyph before its text is read, so the mapping has to be exhaustive — adding
 * a `CoinSource` without an entry here is a type error rather than a row that
 * renders with no icon.
 */
const SOURCE_STYLE: Record<CoinSource, { icon: LucideIcon; tint: Tint }> = {
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
}

/**
 * One movement in the coin ledger.
 *
 * Green for a credit and red for a debit, but never only that: the amount
 * carries its own `+` or `-`, so the direction survives for a reader who
 * cannot tell the two colours apart.
 */
export const CoinTransactionRow = memo(({ transaction }: Props) => {
  const { colors } = useTheme();
  const { icon, tint } = SOURCE_STYLE[transaction.source];
  const isCredit = transaction.amount > 0;

  return (
    <HStack align="center" gap="md" py="sm">
      <IconBadge icon={icon} tint={colors[tint]} size={26} variant="muted" />

      <VStack flex={1} gap="xxs">
        <AppText variant="bodyStrong" numberOfLines={1}>
          {transaction.title}
        </AppText>
        <AppText variant="micro" color="textTertiary" numberOfLines={1}>
          {formatRelativeDay(transaction.createdAt)}
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
});

CoinTransactionRow.displayName = 'CoinTransactionRow';
