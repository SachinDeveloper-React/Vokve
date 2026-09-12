import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { Delete } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { HydrationEntry } from '../../types/models';
import { formatClockTime } from '../../utils/format';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';
import { WaterDroplet } from '../fitness/WaterDroplet';

interface Props {
  entry: HydrationEntry;
  onRemove: (id: string) => void;
}

/** "250 ml Water", or "1 L Water" once the amount reaches a litre. */
function amountLabel(ml: number): string {
  return ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1)} L Water` : `${ml} ml Water`;
}

/**
 * One drink in today's log.
 *
 * The delete control is its own press target rather than the row being
 * swipeable: a swipe is invisible until it is discovered, and the whole reason
 * this log exists is to take back a tap the user did not mean to make.
 */
export const HydrationLogRow = memo(({ entry, onRemove }: Props) => {
  const { colors } = useTheme();
  const label = amountLabel(entry.ml);
  const time = formatClockTime(entry.at);

  const handleRemove = useCallback(() => onRemove(entry.id), [
    entry.id,
    onRemove,
  ]);

  return (
    <HStack align="center" gap="md" py="sm">
      <WaterDroplet size={18} />

      <AppText variant="bodyStrong" numberOfLines={1} style={styles.label}>
        {label}
      </AppText>

      <AppText variant="micro" color="textTertiary" numberOfLines={1}>
        {time}
      </AppText>

      <Pressable
        onPress={handleRemove}
        feedback="opacity"
        visualSize={20}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${label} logged at ${time}`}
      >
        <Icon as={Delete} size="sm" tint={colors.textTertiary} />
      </Pressable>
    </HStack>
  );
});

HydrationLogRow.displayName = 'HydrationLogRow';

/** Takes the row's spare width so the time and the delete stay right-aligned. */
const styles = StyleSheet.create({
  label: { flex: 1 },
});
