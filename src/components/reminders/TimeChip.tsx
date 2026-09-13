import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { Check, Plus } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { formatTimeOfDay } from '../../utils/format';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  /** The reminder this chip toggles, or null for the chip that adds one. */
  id: string | null;
  /** `HH:mm`, or null for the chip that adds a new one. */
  time: string | null;
  /** Whether this time is switched on. Ignored by the add chip. */
  enabled?: boolean;
  /** The block's colour. Pass a theme colour. */
  tint: string;
  /** Called with the chip's id, or null from the add chip. */
  onPress: (id: string | null) => void;
}

/**
 * One preset time, or the chip that adds another to the block.
 *
 * A check rather than a switch: the chips are a block of small, equal things
 * and a row of toggles at this size is both hard to hit and hard to scan. The
 * chip also dims when it is off, so the state survives for a reader who cannot
 * make out a small tick.
 */
export const TimeChip = memo(
  ({ id, time, enabled = true, tint, onPress }: Props) => {
    const { colors, isDark } = useTheme();
    const isAdd = time === null;

    // Bound here rather than in the block above, so a chip keeps the same
    // handler between renders and `memo` has something to compare.
    const handlePress = useCallback(() => onPress(id), [id, onPress]);

    const background = isAdd
      ? colors.muted
      : enabled
      ? withAlpha(tint, isDark ? 0.22 : 0.12)
      : colors.muted;
    const foreground = isAdd
      ? colors.textSecondary
      : enabled
      ? tint
      : colors.textTertiary;

    return (
      <Pressable
        onPress={handlePress}
        feedback="opacity"
        accessibilityRole="button"
        accessibilityState={{ selected: !isAdd && enabled }}
        accessibilityLabel={
          isAdd
            ? 'Add a time to this block'
            : `${formatTimeOfDay(time)}, ${enabled ? 'on' : 'off'}`
        }
      >
        <HStack
          align="center"
          justify="center"
          gap="xs"
          px="sm"
          py="sm"
          style={[styles.chip, { backgroundColor: background }]}
        >
          {isAdd ? <Icon as={Plus} size="xs" tint={foreground} /> : null}

          <AppText
            variant="micro"
            numberOfLines={1}
            style={[styles.label, { color: foreground }]}
          >
            {isAdd ? 'Add Time' : formatTimeOfDay(time)}
          </AppText>

          {!isAdd && enabled ? (
            <Icon as={Check} size="xs" tint={foreground} strokeWidth={3} />
          ) : null}
        </HStack>
      </Pressable>
    );
  },
);

TimeChip.displayName = 'TimeChip';

const styles = StyleSheet.create({
  chip: { borderRadius: radius.md },
  label: { fontWeight: '600' },
});
