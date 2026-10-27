import React, { memo, useCallback } from 'react';
import { Switch as RNSwitch } from 'react-native';
import { Clock, EllipsisVertical } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { HydrationReminder } from '../../types/models';
import { formatTimeOfDay } from '../../utils/format';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  reminder: HydrationReminder;
  /** What the row repeats on — "Everyday", or the days themselves. */
  repeatLabel: string;
  onToggle: (id: string) => void;
  onPressMore: (id: string) => void;
  /**
   * The row held down: open this time's sheet, where it is changed or
   * deleted. Also the kebab's first action.
   */
  onEdit: (id: string) => void;
}

/**
 * One time the user set themselves.
 *
 * A switch here where the preset chips take a tick: a custom time is a row
 * with room for a proper control, and the switch is what makes "keep it but
 * silence it" different from the kebab's "delete it" — a distinction the chips
 * are too small to offer and do not need.
 *
 * Held down, the row changes its time. The press itself stays unbound: the
 * two controls on the right are what a tap is for, and a row that also did
 * something on tap would fire while somebody was reaching for the switch.
 */
export const CustomTimeRow = memo(
  ({ reminder, repeatLabel, onToggle, onPressMore, onEdit }: Props) => {
    const { colors } = useTheme();
    const time = formatTimeOfDay(reminder.time);

    const handleToggle = useCallback(
      () => onToggle(reminder.id),
      [onToggle, reminder.id],
    );
    const handleMore = useCallback(
      () => onPressMore(reminder.id),
      [onPressMore, reminder.id],
    );
    const handleEdit = useCallback(
      () => onEdit(reminder.id),
      [onEdit, reminder.id],
    );

    return (
      <HStack align="center" gap="md" py="sm">
        <Icon as={Clock} size="sm" color="textSecondary" />

        <Pressable
          onLongPress={handleEdit}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel={`${time}, ${repeatLabel}`}
          accessibilityHint="Press and hold to change or delete this time"
        >
          <HStack align="center" gap="md">
            <AppText variant="bodyStrong" numberOfLines={1}>
              {time}
            </AppText>

            <AppText variant="micro" color="textSecondary" numberOfLines={1}>
              {repeatLabel}
            </AppText>
          </HStack>
        </Pressable>

        <HStack flex={1} align="center" justify="end" gap="sm">
          <RNSwitch
            value={reminder.enabled}
            onValueChange={handleToggle}
            trackColor={{ false: colors.switchBackground, true: colors.success }}
            thumbColor={colors.card}
            accessibilityRole="switch"
            accessibilityLabel={`${time} reminder`}
            accessibilityState={{ checked: reminder.enabled }}
          />

          <Pressable
            onPress={handleMore}
            feedback="opacity"
            visualSize={24}
            accessibilityRole="button"
            accessibilityLabel={`More options for the ${time} reminder`}
          >
            <Icon as={EllipsisVertical} size="sm" color="textTertiary" />
          </Pressable>
        </HStack>
      </HStack>
    );
  },
);

CustomTimeRow.displayName = 'CustomTimeRow';
