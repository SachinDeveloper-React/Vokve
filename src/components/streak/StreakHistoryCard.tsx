import React, { memo } from 'react';
import { ChevronRight, History } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { StreakHistoryDay } from '../../types/models';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { StreakHistoryRow } from './StreakHistoryRow';

/** Days shown inline. The rest is behind "View All". */
const MAX_ROWS = 3;

interface Props {
  days: StreakHistoryDay[];
  /** The first page is still in flight. */
  loading?: boolean;
  /** Days on record in total — what "View All" opens onto. */
  total: number;
  onPressViewAll: () => void;
}

/**
 * The last few days of the record.
 *
 * Three rows because the card sits under everything else the screen has to
 * say; the whole record is a screen of its own, which is what "View All"
 * leads to. Three is also enough to show the one thing this card exists for:
 * that a break has a shape — a completed day, a missed one, and what was
 * done about it.
 */
export const StreakHistoryCard = memo(
  ({ days, loading = false, total, onPressViewAll }: Props) => {
    const { colors } = useTheme();
    const visible = days.slice(0, MAX_ROWS);

    return (
      <Card radius="xl" padding="base">
        <VStack gap="sm">
          <HStack align="center" justify="between" gap="sm">
            <HStack align="center" gap="sm">
              <Icon as={History} size="sm" color="textSecondary" />
              <AppText variant="h3">Streak History</AppText>
            </HStack>

            {total > visible.length ? (
              <Pressable
                onPress={onPressViewAll}
                feedback="opacity"
                accessibilityRole="link"
                accessibilityLabel="View all streak history"
              >
                <HStack align="center" gap="xxs">
                  <AppText variant="micro" style={{ color: colors.brandAccent }}>
                    View All
                  </AppText>
                  <Icon as={ChevronRight} size="xs" tint={colors.brandAccent} />
                </HStack>
              </Pressable>
            ) : null}
          </HStack>

          {visible.length === 0 ? (
            <AppText variant="micro" color="textSecondary">
              {loading
                ? 'Loading your record…'
                : 'Your record starts with the first day that counts.'}
            </AppText>
          ) : (
            visible.map((entry, index) => (
              <React.Fragment key={entry.date}>
                {index > 0 ? <Divider /> : null}
                <StreakHistoryRow entry={entry} />
              </React.Fragment>
            ))
          )}
        </VStack>
      </Card>
    );
  },
);

StreakHistoryCard.displayName = 'StreakHistoryCard';
