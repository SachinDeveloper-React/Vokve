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
}

/**
 * One time the user set themselves.
 *
 * A switch here where the preset chips take a tick: a custom time is a row
 * with room for a proper control, and the switch is what makes "keep it but
 * silence it" different from the kebab's "delete it" — a distinction the chips
 * are too small to offer and do not need.
 */
export const CustomTimeRow = memo(
  ({ reminder, repeatLabel, onToggle, onPressMore }: Props) => {
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

    return (
      <HStack align="center" gap="md" py="sm">
        <Icon as={Clock} size="sm" color="textSecondary" />

        <AppText variant="bodyStrong" numberOfLines={1}>
          {time}
        </AppText>

        <AppText variant="micro" color="textSecondary" numberOfLines={1}>
          {repeatLabel}
        </AppText>

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
