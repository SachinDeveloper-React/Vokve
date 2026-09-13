import React, { Fragment, memo } from 'react';
import { Heart } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { VitalReading } from '../../types/models';
import { formatClockTime, formatRelativeDay } from '../../utils/format';
import { STATUS_STYLE, statusOf } from '../health/vitals';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';

interface RowProps {
  reading: VitalReading;
}

const ReadingRow = memo(({ reading }: RowProps) => {
  const { colors } = useTheme();
  const status = STATUS_STYLE[statusOf(reading)];
  const when = `${formatRelativeDay(reading.recordedAt)}, ${formatClockTime(
    reading.recordedAt,
  )}`;

  return (
    <HStack
      align="center"
      gap="md"
      py="sm"
      accessible
      accessibilityLabel={`${Math.round(reading.value)} beats per minute, ${
        status.label
      }, ${when}`}
    >
      <Icon as={Heart} size="sm" tint={colors.destructive} />

      <VStack flex={1} gap="xxs">
        <AppText variant="bodyStrong" numberOfLines={1}>
          {`${Math.round(reading.value)} bpm`}
        </AppText>
        <AppText
          variant="miniMicro"
          numberOfLines={1}
          style={{ color: colors[status.tint] }}
        >
          {status.label}
        </AppText>
      </VStack>

      <AppText variant="micro" color="textTertiary" numberOfLines={1}>
        {when}
      </AppText>
    </HStack>
  );
});

ReadingRow.displayName = 'ReadingRow';

interface Props {
  readings: VitalReading[];
  onPressViewAll: () => void;
}

/**
 * The last few readings, newest first.
 *
 * Each one carries its own verdict rather than being measured against the one
 * at the top of the screen: a pulse of 104 taken after a walk is a different
 * fact from today's resting 72, and a list that only showed numbers would
 * leave the user to work out which was which.
 */
export const RecentHeartReadingsCard = memo(
  ({ readings, onPressViewAll }: Props) => (
    <Card radius="xl" padding="base">
      <VStack gap="sm">
        <HStack align="center" justify="between" gap="sm">
          <AppText variant="h3" numberOfLines={1}>
            Recent Readings
          </AppText>

          <Pressable
            onPress={onPressViewAll}
            feedback="opacity"
            accessibilityRole="link"
            accessibilityLabel="View all heart rate readings"
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
                <ReadingRow reading={reading} />
              </Fragment>
            ))}
          </VStack>
        )}
      </VStack>
    </Card>
  ),
);

RecentHeartReadingsCard.displayName = 'RecentHeartReadingsCard';
