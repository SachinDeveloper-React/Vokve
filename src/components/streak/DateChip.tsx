import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { CalendarCheck, ChevronDown } from 'lucide-react-native';
import { radius } from '../../theme';
import { formatLongDate, todayIso, type IsoDate } from '../../utils/date';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

export type DateChipSize = 'md' | 'sm';

interface Props {
  /** The day shown. Defaults to today. */
  date?: IsoDate;
  /**
   * `sm` is the pill form, for a row the chip has to share with a filter.
   * `md` leads a screen on its own and is sized to be the first thing read.
   */
  size?: DateChipSize;
  /** Opens whatever changes the day — a calendar, or a jump back to today. */
  onPress: () => void;
  /** What the chip does, for the screen reader. */
  accessibilityHint?: string;
}

/**
 * "Today, 26 May 2025" — the anchor the rest of the screen is measured from.
 *
 * A pill rather than a line of text so it reads as the control it is: this is
 * the one tap that moves the day everything else is shown for, and a date that
 * merely *looked* tappable would leave the user hunting for the real control.
 *
 * The small form keeps the same shape at a size that fits beside a filter row.
 * It is under the 44pt touch floor, which is what `visualSize` is for: the
 * pill stays small and the target it answers to does not.
 */
export const DateChip = memo(
  ({
    date = todayIso(),
    size = 'md',
    onPress,
    accessibilityHint = 'Show this month',
  }: Props) => {
    const isToday = date === todayIso();
    const label = `${isToday ? 'Today, ' : ''}${formatLongDate(date)}`;
    const small = size === 'sm';

    return (
      <Pressable
        onPress={onPress}
        feedback="opacity"
        visualSize={small ? 32 : 44}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${accessibilityHint}`}
      >
        <HStack
          align="center"
          gap={small ? 'xs' : 'sm'}
          px={small ? 'md' : 'base'}
          py={small ? 'sm' : 'md'}
          bg="card"
          bordered
          style={[styles.chip, small ? styles.pill : styles.rounded]}
        >
          <Icon
            as={CalendarCheck}
            size={small ? 'xs' : 'sm'}
            color="textSecondary"
          />
          <AppText variant={small ? 'micro' : 'bodyStrong'} style={styles.label}>
            {label}
          </AppText>
          <Icon as={ChevronDown} size="xs" color="textTertiary" />
        </HStack>
      </Pressable>
    );
  },
);

DateChip.displayName = 'DateChip';

const styles = StyleSheet.create({
  /** Hugs its label instead of stretching to the screen's width. */
  chip: { alignSelf: 'flex-start' },
  rounded: { borderRadius: radius.lg },
  pill: { borderRadius: radius.pill },
  // The date is the label the row is read by, so it keeps its weight at both
  // sizes — `micro` is a size step, not a demotion to a caption.
  label: { fontWeight: '600' },
});
