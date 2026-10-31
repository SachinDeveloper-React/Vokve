import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import type { VitalReading } from '../../types/models';
import { formatClockTime } from '../../utils/format';
import { formatLongDate, toIsoDate } from '../../utils/date';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { STATUS_STYLE, VITAL_STYLE, formatVitalValue, statusOf } from './vitals';

/** "26 May, 9:30 AM" — the date without its year, which is almost always this one. */
export function formatStamp(recordedAt: string): string {
  const at = new Date(recordedAt);
  if (Number.isNaN(at.getTime())) {
    return '';
  }

  const day = formatLongDate(toIsoDate(at)).split(' ').slice(0, 2).join(' ');
  return `${day}, ${formatClockTime(recordedAt)}`;
}

interface Props {
  reading: VitalReading;
  /**
   * Leaves the date off and keeps only the time, for a list that already
   * groups its rows under the day they were taken.
   */
  timeOnly?: boolean;
}

/**
 * One logged reading: what it was of, the figure, the verdict, and when.
 *
 * Shared by the checkup's recent-history card and the full archive, which is
 * the point — the two are the same list at two lengths, and a second row
 * renderer is how one of them ends up calling 118 elevated while the other
 * calls it high.
 *
 * The verdict is worked out from the figure at render (`statusOf`) rather than
 * stored beside it, so a number and its reading cannot drift apart.
 */
export const VitalReadingRow = memo(({ reading, timeOnly = false }: Props) => {
  const { colors } = useTheme();
  const { label, unit } = VITAL_STYLE[reading.kind];
  const status = STATUS_STYLE[statusOf(reading)];
  const stamp = timeOnly
    ? formatClockTime(reading.recordedAt)
    : formatStamp(reading.recordedAt);

  return (
    <HStack
      align="center"
      gap="sm"
      py="sm"
      accessible
      accessibilityLabel={`${label}, ${formatVitalValue(
        reading,
      )} ${unit}, ${status.label}, ${formatStamp(reading.recordedAt)}`}
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

VitalReadingRow.displayName = 'VitalReadingRow';

/**
 * Text in a row does not shrink by default, so a long vital name would run
 * under the figure beside it rather than truncating.
 */
const styles = StyleSheet.create({
  label: { flexShrink: 1 },
});
