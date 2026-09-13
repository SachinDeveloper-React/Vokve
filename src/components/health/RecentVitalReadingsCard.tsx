import React, { Fragment, memo } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { VitalReading } from '../../types/models';
import { formatClockTime, formatRelativeDay } from '../../utils/format';
import {
  STATUS_STYLE,
  VITAL_STYLE,
  formatVitalValue,
  statusOf,
} from './vitals';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';

interface RowProps {
  reading: VitalReading;
  icon: LucideIcon;
  tint: string;
}

const ReadingRow = memo(({ reading, icon, tint }: RowProps) => {
  const { colors } = useTheme();
  const status = STATUS_STYLE[statusOf(reading)];
  const { unit, spokenUnit } = VITAL_STYLE[reading.kind];
  const figure = formatVitalValue(reading);
  const when = `${formatRelativeDay(reading.recordedAt)}, ${formatClockTime(
    reading.recordedAt,
  )}`;

  return (
    <HStack
      align="center"
      gap="md"
      py="sm"
      accessible
      accessibilityLabel={`${figure} ${spokenUnit}, ${status.label}, ${when}`}
    >
      <Icon as={icon} size="sm" tint={tint} />

      <VStack flex={1} gap="xxs">
        <AppText variant="bodyStrong" numberOfLines={1}>
          {unit ? `${figure} ${unit}` : figure}
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
  /** The glyph beside each row, in the vital's own colour. */
  icon: LucideIcon;
  tint: string;
  /** What the "View All" link is for, for the screen reader. */
  viewAllLabel: string;
  onPressViewAll: () => void;
}

/**
 * The last few readings of one vital, newest first.
 *
 * Each one carries its own verdict rather than being measured against the one
 * at the top of the screen: a pulse of 104 taken after a walk is a different
 * fact from today's resting 72, and a list that only showed numbers would
 * leave the user to work out which was which.
 */
export const RecentVitalReadingsCard = memo(
  ({ readings, icon, tint, viewAllLabel, onPressViewAll }: Props) => (
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
            accessibilityLabel={viewAllLabel}
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
                <ReadingRow reading={reading} icon={icon} tint={tint} />
              </Fragment>
            ))}
          </VStack>
        )}
      </VStack>
    </Card>
  ),
);

RecentVitalReadingsCard.displayName = 'RecentVitalReadingsCard';
