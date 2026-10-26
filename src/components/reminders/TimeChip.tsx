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
  /**
   * Held down: change this time rather than switch it off. Never called by
   * the add chip, which has no time to change.
   */
  onLongPress?: (id: string) => void;
  /**
   * The add chip of a block that already holds all the times it may (see
   * `SLOT_RULES`). Still drawn and still pressable — it says what the limit
   * is when it is tapped, where a chip that had quietly disappeared would
   * leave the user looking for the control rather than reading the rule.
   */
  full?: boolean;
  /**
   * The block this chip adds to, for the add chip's label. Three blocks
   * carry the same control, and "add a time to this block" names none of
   * them for a screen reader moving between them.
   */
  blockName?: string;
}

/**
 * One preset time, or the chip that adds another to the block.
 *
 * A check rather than a switch: the chips are a block of small, equal things
 * and a row of toggles at this size is both hard to hit and hard to scan. The
 * chip also dims when it is off, so the state survives for a reader who cannot
 * make out a small tick.
 *
 * Changing the time is the long press, because the tap is already spoken for
 * and a chip this size has room for one control, not two. The gesture is
 * named in the section's own subtitle rather than left to be discovered, and
 * `accessibilityHint` is how a screen reader is told about it.
 */
export const TimeChip = memo(
  ({
    id,
    time,
    enabled = true,
    tint,
    onPress,
    onLongPress,
    full = false,
    blockName,
  }: Props) => {
    const { colors, isDark } = useTheme();
    const isAdd = time === null;

    // Bound here rather than in the block above, so a chip keeps the same
    // handler between renders and `memo` has something to compare.
    const handlePress = useCallback(() => onPress(id), [id, onPress]);
    const handleLongPress = useCallback(() => {
      if (id !== null) onLongPress?.(id);
    }, [id, onLongPress]);

    const background = isAdd
      ? colors.muted
      : enabled
      ? withAlpha(tint, isDark ? 0.22 : 0.12)
      : colors.muted;
    const foreground = isAdd
      ? full
        ? colors.textTertiary
        : colors.textSecondary
      : enabled
      ? tint
      : colors.textTertiary;

    return (
      <Pressable
        onPress={handlePress}
        onLongPress={isAdd || !onLongPress ? undefined : handleLongPress}
        feedback="opacity"
        accessibilityRole="button"
        accessibilityState={{ selected: !isAdd && enabled }}
        accessibilityLabel={
          isAdd
            ? full
              ? `${blockName ?? 'This block'} is full`
              : `Add a time to ${blockName ?? 'this block'}`
            : `${formatTimeOfDay(time)}, ${enabled ? 'on' : 'off'}`
        }
        accessibilityHint={
          isAdd || !onLongPress
            ? undefined
            : 'Double tap to switch it on or off, or press and hold to change the time'
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
          {isAdd && !full ? (
            <Icon as={Plus} size="xs" tint={foreground} />
          ) : null}

          <AppText
            variant="micro"
            numberOfLines={1}
            style={[styles.label, { color: foreground }]}
          >
            {isAdd ? (full ? 'Full' : 'Add Time') : formatTimeOfDay(time)}
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
