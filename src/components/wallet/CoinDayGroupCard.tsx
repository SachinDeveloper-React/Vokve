import React, { Fragment, memo } from 'react';
import { spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { CoinTransaction } from '../../types/models';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { CoinAmount } from './CoinAmount';
import { CoinTransactionRow } from './CoinTransactionRow';

/**
 * Starts the separators under the text rather than under the badge, so the
 * icons read as one column — the same inset the wallet's recent card uses.
 */
const ROW_INDENT = moderateScale(26) + spacing.md;

export interface CoinDayGroup {
  /** `YYYY-MM-DD`, what keeps two "12 Sep"s a year apart separate. */
  date: string;
  /** The heading — "Today", "Yesterday", "3 days ago", "12 Sep". */
  title: string;
  /** Newest first. */
  transactions: CoinTransaction[];
  /** Earned minus spent that day, signed. */
  net: number;
}

interface Props {
  group: CoinDayGroup;
}

/**
 * A day's coin movements, under its heading.
 *
 * One card per day rather than one long card with headings inside it, as the
 * notification centre does: the gap between cards is what tells the eye a
 * day has ended. The day's net sits on the heading's right so a user
 * scanning for "what did Tuesday come to" gets the answer without adding up
 * the rows — and it is signed, because a day can end below where it began.
 */
export const CoinDayGroupCard = memo(({ group }: Props) => {
  const { colors } = useTheme();
  const netTint =
    group.net > 0
      ? colors.success
      : group.net < 0
      ? colors.destructive
      : colors.textSecondary;

  return (
    <VStack gap="sm">
      <HStack align="center" justify="between" gap="sm">
        <AppText variant="h3">{group.title}</AppText>
        <CoinAmount amount={group.net} size="sm" signed tint={netTint} />
      </HStack>

      <Card radius="xl" padding="md">
        <VStack>
          {group.transactions.map((transaction, index) => (
            <Fragment key={transaction.id}>
              {index > 0 ? <Divider indent={ROW_INDENT} /> : null}
              <CoinTransactionRow transaction={transaction} when="time" />
            </Fragment>
          ))}
        </VStack>
      </Card>
    </VStack>
  );
});

CoinDayGroupCard.displayName = 'CoinDayGroupCard';
