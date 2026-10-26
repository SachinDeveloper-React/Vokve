import React, { memo } from 'react';
import { ChevronRight } from 'lucide-react-native';
import { SLOT_RULES, type SlotRules } from '../../constants/reminderSlots';
import { useTheme } from '../../theme';
import type { HydrationReminder, ReminderSlot } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';
import { PresetBlockCard } from './PresetBlockCard';

interface Props {
  morning: HydrationReminder[];
  afternoon: HydrationReminder[];
  evening: HydrationReminder[];
  onToggle: (id: string) => void;
  onPressAdd: (slot: ReminderSlot) => void;
  /** A chip held down: change that time. */
  onEdit: (id: string) => void;
  onPressViewAll: () => void;
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
 * and the alternative for a user who wants 09:00 instead of 08:00 is
 * deleting one chip and adding another.
 */
export const PresetTimesSection = memo(
  ({
    morning,
    afternoon,
    evening,
    onToggle,
    onPressAdd,
    onEdit,
    onPressViewAll,
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
            <AppText variant="micro" color="textSecondary" numberOfLines={1}>
              Tap to switch a time off · hold to change it
            </AppText>
          </VStack>

          <Pressable
            onPress={onPressViewAll}
            feedback="opacity"
            accessibilityRole="link"
            accessibilityLabel="View all presets"
          >
            <HStack align="center" gap="xxs">
              <AppText variant="micro" style={{ color: colors.brandAccent }}>
                View All Presets
              </AppText>
              <Icon as={ChevronRight} size="xs" tint={colors.brandAccent} />
            </HStack>
          </Pressable>
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
