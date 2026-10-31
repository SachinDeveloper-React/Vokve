import React, { Fragment, memo } from 'react';
import type { VitalReading } from '../../types/models';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { VitalReadingRow } from './VitalReadingRow';

interface Props {
  readings: VitalReading[];
  onPressViewAll: () => void;
}

/**
 * The last few readings, whatever they were of.
 *
 * Mixed rather than grouped by vital: the question this answers is "what have
 * I logged lately", and four short lists of one row each would answer a
 * different one. The tiles above are where a single vital is read.
 *
 * The rows themselves are `VitalReadingRow`, shared with the full archive
 * behind "View All" — the two are one list at two lengths.
 */
export const RecentHistoryCard = memo(({ readings, onPressViewAll }: Props) => (
  <Card radius="xl" padding="base">
    <VStack gap="sm">
      <HStack align="center" justify="between" gap="sm">
        <AppText variant="h3" numberOfLines={1}>
          Recent History
        </AppText>

        <Pressable
          onPress={onPressViewAll}
          feedback="opacity"
          accessibilityRole="link"
          accessibilityLabel="View all readings"
        >
          <AppText variant="micro" color="primary">
            View All
          </AppText>
        </Pressable>
      </HStack>

      {readings.length === 0 ? (
        <AppText variant="micro" color="textSecondary">
          Nothing logged yet — your first reading will show up here.
        </AppText>
      ) : (
        <VStack>
          {readings.map((reading, index) => (
            <Fragment key={reading.id}>
              {index > 0 ? <Divider /> : null}
              <VitalReadingRow reading={reading} />
            </Fragment>
          ))}
        </VStack>
      )}
    </VStack>
  </Card>
));

RecentHistoryCard.displayName = 'RecentHistoryCard';
