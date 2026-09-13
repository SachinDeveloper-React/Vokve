import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import type { HydrationReminder, ReminderSlot } from '../../types/models';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { TimeChip } from './TimeChip';

interface Props {
  slot: ReminderSlot;
  title: string;
  /** The block's colour, which its chips take. Pass a theme colour. */
  tint: string;
  reminders: HydrationReminder[];
  onToggle: (id: string) => void;
  onPressAdd: (slot: ReminderSlot) => void;
}

/**
 * One part of the day, and the times set in it.
 *
 * The count under the title says how many times the block holds, not how many
 * are switched on: it is the size of the block, and a number that shrank as
 * the user turned chips off would make the block look as though times had been
 * deleted.
 */
export const PresetBlockCard = memo(
  ({ slot, title, tint, reminders, onToggle, onPressAdd }: Props) => {
    // One handler for every chip in the block: the add chip reports a null id,
    // which is the only thing that tells the two apart.
    const handleChipPress = useCallback(
      (id: string | null) => {
        if (id === null) {
          onPressAdd(slot);
          return;
        }
        onToggle(id);
      },
      [onPressAdd, onToggle, slot],
    );

    return (
      <Card radius="lg" padding="md" style={styles.card}>
        <VStack gap="sm">
          <VStack gap="none">
            <AppText variant="bodyStrong" numberOfLines={1}>
              {title}
            </AppText>
            <AppText variant="miniMicro" color="textSecondary">
              {`${reminders.length} ${
                reminders.length === 1 ? 'time' : 'times'
              }`}
            </AppText>
          </VStack>

          <VStack gap="xs">
            {reminders.map(reminder => (
              <TimeChip
                key={reminder.id}
                id={reminder.id}
                time={reminder.time}
                enabled={reminder.enabled}
                tint={tint}
                onPress={handleChipPress}
              />
            ))}

            <TimeChip
              id={null}
              time={null}
              tint={tint}
              onPress={handleChipPress}
            />
          </VStack>
        </VStack>
      </Card>
    );
  },
);

PresetBlockCard.displayName = 'PresetBlockCard';

/** Three blocks share the row, so each takes an equal share of it. */
const styles = StyleSheet.create({
  card: { flex: 1 },
});
