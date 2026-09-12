import React, { Fragment, memo } from 'react';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { HydrationEntry } from '../../types/models';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { HydrationLogRow } from './HydrationLogRow';

interface Props {
  /** Newest first, as the store keeps them. */
  entries: HydrationEntry[];
  onRemove: (id: string) => void;
  onPressHistory: () => void;
}

/**
 * Everything logged today, in the order it went in.
 *
 * Under the quick-add row rather than above it: the row is what the user came
 * to press, and the log is the receipt that appears once they have. An empty
 * log says so in a line instead of an empty card — the first drink of the day
 * is the one worth encouraging.
 */
export const HydrationLogCard = memo(
  ({ entries, onRemove, onPressHistory }: Props) => {
    const { colors } = useTheme();

    return (
      <VStack gap="sm">
        <HStack align="center" justify="between" gap="sm">
          <AppText variant="h3">Today's Log</AppText>

          <Pressable
            onPress={onPressHistory}
            feedback="opacity"
            accessibilityRole="link"
            accessibilityLabel="View hydration history"
          >
            <HStack align="center" gap="xxs">
              <AppText variant="micro" color="primary">
                View History
              </AppText>
              <Icon as={ChevronRight} size="xs" tint={colors.primary} />
            </HStack>
          </Pressable>
        </HStack>

        <Card radius="xl" padding="base">
          {entries.length === 0 ? (
            <AppText variant="micro" color="textSecondary">
              Nothing logged yet today — the first glass is one tap away.
            </AppText>
          ) : (
            <VStack>
              {entries.map((entry, index) => (
                <Fragment key={entry.id}>
                  {index > 0 ? <Divider /> : null}
                  <HydrationLogRow entry={entry} onRemove={onRemove} />
                </Fragment>
              ))}
            </VStack>
          )}
        </Card>
      </VStack>
    );
  },
);

HydrationLogCard.displayName = 'HydrationLogCard';
