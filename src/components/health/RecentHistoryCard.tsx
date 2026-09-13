import React, { Fragment, memo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import type { VitalReading } from '../../types/models';
import { formatClockTime } from '../../utils/format';
import { formatLongDate, toIsoDate } from '../../utils/date';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import {
  STATUS_STYLE,
  VITAL_STYLE,
  formatVitalValue,
  statusOf,
} from './vitals';

/** "26 May, 9:30 AM" — the date without its year, which is always this one. */
function formatStamp(recordedAt: string): string {
  const at = new Date(recordedAt);
  if (Number.isNaN(at.getTime())) {
    return '';
  }

  const day = formatLongDate(toIsoDate(at)).split(' ').slice(0, 2).join(' ');
  return `${day}, ${formatClockTime(recordedAt)}`;
}

interface RowProps {
  reading: VitalReading;
}

const HistoryRow = memo(({ reading }: RowProps) => {
  const { colors } = useTheme();
  const { label, unit } = VITAL_STYLE[reading.kind];
  const status = STATUS_STYLE[statusOf(reading)];
  const stamp = formatStamp(reading.recordedAt);

  return (
    <HStack
      align="center"
      gap="sm"
      py="sm"
      accessible
      accessibilityLabel={`${label}, ${formatVitalValue(
        reading,
      )} ${unit}, ${status.label}, ${stamp}`}
    >
      <AppText variant="micro" numberOfLines={1} style={styles.label}>
        {label}
      </AppText>

      <AppText variant="micro" color="textSecondary" numberOfLines={1}>
        {`${formatVitalValue(reading)}${unit ? ` ${unit}` : ''}`}
      </AppText>

      <HStack flex={1} align="center" justify="end" gap="sm">
        <AppText
          variant="miniMicro"
          numberOfLines={1}
          style={{ color: colors[status.tint] }}
        >
          {status.label}
        </AppText>

        <AppText variant="miniMicro" color="textTertiary" numberOfLines={1}>
          {stamp}
        </AppText>
      </HStack>
    </HStack>
  );
});

HistoryRow.displayName = 'HistoryRow';

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
              <HistoryRow reading={reading} />
            </Fragment>
          ))}
        </VStack>
      )}
    </VStack>
  </Card>
));

RecentHistoryCard.displayName = 'RecentHistoryCard';

/**
 * Text in a row does not shrink by default, so a long vital name would run
 * under the figure beside it rather than truncating.
 */
const styles = StyleSheet.create({
  label: { flexShrink: 1 },
});
