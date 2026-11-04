import React, { memo } from 'react';
import { SLOT_RULES, type SlotRules } from '../../constants/reminderSlots';
import { useTheme } from '../../theme';
import type { HydrationReminder, ReminderSlot } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { PresetBlockCard } from './PresetBlockCard';

interface Props {
  morning: HydrationReminder[];
  afternoon: HydrationReminder[];
  evening: HydrationReminder[];
  onToggle: (id: string) => void;
  onPressAdd: (slot: ReminderSlot) => void;
  /** A chip held down: change that time. */
  onEdit: (id: string) => void;
  /** What each block will take (Y5b). The server's, through the plan. */
  rules?: SlotRules;
}

/**
 * The suggested times, grouped into the three parts of a day.
 *
 * Three blocks across rather than one list of nine times: a reminder plan is
 * something a user checks for gaps — nothing all afternoon — and a flat list
 * makes finding that gap an act of arithmetic. Each block keeps its own colour
 * so the eye can tell which part of the day it is looking at without reading
 * the times.
 *
 * The subtitle says what a long press does, because a gesture nothing on
 * screen mentions is a feature only the person who built it knows about —
 * and holding a chip is the only way to a time's own sheet, which is where
 * both changing it and deleting it live.
 */
export const PresetTimesSection = memo(
  ({
    morning,
    afternoon,
    evening,
    onToggle,
    onPressAdd,
    onEdit,
    rules = SLOT_RULES,
  }: Props) => {
    const { colors } = useTheme();

    return (
      <VStack gap="sm">
        <HStack align="center" justify="between" gap="sm">
          <VStack flex={1} gap="xxs">
            <AppText variant="h3" numberOfLines={1}>
              Smart Preset Times
            </AppText>
            <AppText variant="micro" color="textSecondary" numberOfLines={2}>
              Tap to switch a time off · hold to change or delete it
            </AppText>
          </VStack>
        </HStack>

        <HStack align="stretch" gap="sm">
          <PresetBlockCard
            slot="morning"
            title="Morning"
            maxTimes={rules.morning.maxTimes}
            tint={colors.primary}
            reminders={morning}
            onToggle={onToggle}
            onPressAdd={onPressAdd}
            onEdit={onEdit}
          />
          <PresetBlockCard
            slot="afternoon"
            title="Afternoon"
            maxTimes={rules.afternoon.maxTimes}
            tint={colors.brandAccent}
            reminders={afternoon}
            onToggle={onToggle}
            onPressAdd={onPressAdd}
            onEdit={onEdit}
          />
          <PresetBlockCard
            slot="evening"
            title="Evening"
            maxTimes={rules.evening.maxTimes}
            tint={colors.avatarPurple}
            reminders={evening}
            onToggle={onToggle}
            onPressAdd={onPressAdd}
            onEdit={onEdit}
          />
        </HStack>
      </VStack>
    );
  },
);

PresetTimesSection.displayName = 'PresetTimesSection';
