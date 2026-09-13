import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { CalendarDays, ChevronDown } from 'lucide-react-native';
import { radius } from '../../theme';
import { formatLongDate, type IsoDate } from '../../utils/date';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface ChipProps {
  label: string;
  date: IsoDate;
  onPress: () => void;
}

const RangeChip = memo(({ label, date, onPress }: ChipProps) => (
  <Pressable
    onPress={onPress}
    feedback="opacity"
    accessibilityRole="button"
    accessibilityLabel={`${label}, ${formatLongDate(date)}. Change it`}
    style={styles.half}
  >
    <VStack gap="xxs" px="base" py="md" bg="card" bordered style={styles.chip}>
      <AppText variant="miniMicro" color="textSecondary">
        {label}
      </AppText>

      <HStack align="center" gap="sm">
        <Icon as={CalendarDays} size="xs" color="textSecondary" />
        <AppText variant="micro" numberOfLines={1} style={styles.value}>
          {formatLongDate(date)}
        </AppText>
        <Icon as={ChevronDown} size="xs" color="textTertiary" />
      </HStack>
    </VStack>
  </Pressable>
));

RangeChip.displayName = 'RangeChip';

interface Props {
  from: IsoDate;
  to: IsoDate;
  onPressFrom: () => void;
  onPressTo: () => void;
}

/**
 * The two ends of a custom span.
 *
 * Two chips rather than one range picker: a range picker has to teach the user
 * which tap is which end, where two labelled fields say it outright — and the
 * commonest edit is moving one end, not redrawing both.
 */
export const CustomRangeRow = memo(
  ({ from, to, onPressFrom, onPressTo }: Props) => (
    <HStack align="stretch" gap="sm">
      <RangeChip label="From" date={from} onPress={onPressFrom} />
      <RangeChip label="To" date={to} onPress={onPressTo} />
    </HStack>
  ),
);

CustomRangeRow.displayName = 'CustomRangeRow';

const styles = StyleSheet.create({
  half: { flex: 1 },
  chip: { borderRadius: radius.lg },
  value: { fontWeight: '600', flexShrink: 1 },
});
