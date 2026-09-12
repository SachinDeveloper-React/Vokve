import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { CalendarCheck, ChevronDown } from 'lucide-react-native';
import { formatLongDate, todayIso, type IsoDate } from '../../utils/date';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  /** The day shown. Defaults to today. */
  date?: IsoDate;
  /** Jumps the calendar below back to this day's month. */
  onPress: () => void;
}

/**
 * "Today, 26 May 2025" — the anchor the rest of the screen is measured from.
 *
 * A pill rather than a line of text so it reads as the control it is: after
 * paging the calendar back a few months, this is the one tap that brings the
 * user home, and a date that merely *looked* tappable would leave them paging
 * forward by hand.
 */
export const DateChip = memo(({ date = todayIso(), onPress }: Props) => {
  const isToday = date === todayIso();
  const label = `${isToday ? 'Today, ' : ''}${formatLongDate(date)}`;

  return (
    <Pressable
      onPress={onPress}
      feedback="opacity"
      accessibilityRole="button"
      accessibilityLabel={`${label}. Show this month`}
    >
      <HStack
        align="center"
        gap="sm"
        px="base"
        py="md"
        radius="lg"
        bg="card"
        bordered
        style={styles.chip}
      >
        <Icon as={CalendarCheck} size="sm" color="textSecondary" />
        <AppText variant="bodyStrong">{label}</AppText>
        <Icon as={ChevronDown} size="xs" color="textTertiary" />
      </HStack>
    </Pressable>
  );
});

DateChip.displayName = 'DateChip';

/** Hugs its label instead of stretching to the screen's width. */
const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start' },
});
