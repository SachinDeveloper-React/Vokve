import React, { Fragment, memo } from 'react';
import { ChevronRight } from 'lucide-react-native';
import { spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Pressable } from '../form/Pressable';
import type { CoinTransaction } from '../../types/models';
import { CoinTransactionRow } from './CoinTransactionRow';

/**
 * How much of the ledger the wallet shows inline. The card is a glance, not an
 * archive — "View All" is what the rest of the history is behind, and a card
 * that grew with the ledger would push everything under it off the screen.
 */
const MAX_ROWS = 4;

/**
 * Starts the separators under the text rather than under the badge, so the
 * icons read as one column instead of being cut into cells.
 */
const ROW_INDENT = moderateScale(26) + spacing.md;

interface Props {
  /** Newest first. Only the first few are shown. */
  transactions: CoinTransaction[];
  onPressViewAll: () => void;
}

/**
 * The recent slice of the coin ledger.
 *
 * Everything above this card on the wallet is a number the app calculated; this
 * is the evidence behind them. Keeping it on the same screen is what lets a
 * user check a balance they did not expect without having to go looking for a
 * statement.
 */
export const RecentTransactionsCard = memo(
  ({ transactions, onPressViewAll }: Props) => {
    const { colors } = useTheme();
    const recent = transactions.slice(0, MAX_ROWS);

    return (
      <Card radius="lg" padding="md">
        <VStack gap="xs">
          <HStack align="center" justify="between" gap="sm">
            <AppText variant="label" color="textSecondary">
              Recent Transactions
            </AppText>

            <Pressable
              onPress={onPressViewAll}
              accessibilityRole="button"
              accessibilityLabel="View all transactions"
            >
              <HStack align="center" gap="xxs">
                <AppText variant="micro" color="primary">
                  View All
                </AppText>
                <Icon as={ChevronRight} size="xs" tint={colors.primary} />
              </HStack>
            </Pressable>
          </HStack>

          {recent.length === 0 ? (
            <EmptyState
              title="No coins yet"
              message="Walk, train and keep your streak alive — every one of them pays out in coins."
            />
          ) : (
            recent.map((transaction, index) => (
              <Fragment key={transaction.id}>
                {index > 0 ? <Divider indent={ROW_INDENT} /> : null}
                <CoinTransactionRow transaction={transaction} />
              </Fragment>
            ))
          )}
        </VStack>
      </Card>
    );
  },
);

RecentTransactionsCard.displayName = 'RecentTransactionsCard';
