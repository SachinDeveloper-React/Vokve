import React, { memo, useCallback } from 'react';
import { StyleSheet, Switch as RNSwitch } from 'react-native';
import { CalendarDays, ChevronRight, Music, Vibrate } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { REPEAT_DAYS } from '../../stores/remindersStore';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';

const DAY = moderateScale(28);

interface DayToggleProps {
  index: number;
  label: string;
  selected: boolean;
  onPress: (index: number) => void;
}

/** Full weekday names, so the row does not announce seven bare letters. */
const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const RepeatDay = memo(({ index, label, selected, onPress }: DayToggleProps) => {
  const { colors, isDark } = useTheme();
  const handlePress = useCallback(() => onPress(index), [index, onPress]);

  return (
    <Pressable
      onPress={handlePress}
      feedback="opacity"
      visualSize={DAY}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${DAY_NAMES[index]}, ${selected ? 'on' : 'off'}`}
    >
      <HStack
        align="center"
        justify="center"
        style={[
          styles.day,
          {
            backgroundColor: selected
              ? withAlpha(colors.primary, isDark ? 0.28 : 0.14)
              : colors.muted,
          },
        ]}
      >
        <AppText
          variant="miniMicro"
          style={[
            styles.dayLabel,
            { color: selected ? colors.primary : colors.textTertiary },
          ]}
        >
          {label}
        </AppText>
      </HStack>
    </Pressable>
  );
});

RepeatDay.displayName = 'RepeatDay';

interface Props {
  sound: string;
  vibration: boolean;
  /** Weekday indices that are on, Monday first. */
  repeatDays: number[];
  onPressSound: () => void;
  onChangeVibration: (value: boolean) => void;
  onToggleDay: (day: number) => void;
}

/**
 * How a reminder arrives: its sound, whether it buzzes, and which days it runs.
 *
 * One card of three rows rather than three cards. None of them is a decision
 * the user makes on its own — they are the settings *of* the plan above, and
 * separating them would give each the weight of a section.
 */
export const ReminderSettingsCard = memo(
  ({
    sound,
    vibration,
    repeatDays,
    onPressSound,
    onChangeVibration,
    onToggleDay,
  }: Props) => {
    const { colors } = useTheme();

    return (
      <VStack gap="sm">
        <AppText variant="h3">Reminder Settings</AppText>

        <Card radius="xl" padding="base">
          <VStack>
            <Pressable
              onPress={onPressSound}
              feedback="highlight"
              accessibilityRole="button"
              accessibilityLabel={`Reminder sound, ${sound}`}
            >
              <HStack align="center" gap="md" py="md">
                <IconBadge
                  icon={Music}
                  tint={colors.primary}
                  size={34}
                  shape="rounded"
                />

                <VStack flex={1} gap="xxs">
                  <AppText variant="bodyStrong">Reminder Sound</AppText>
                  <AppText variant="micro" color="textSecondary">
                    Choose a sound for your reminders
                  </AppText>
                </VStack>

                <AppText variant="micro" color="textSecondary">
                  {sound}
                </AppText>
                <Icon as={ChevronRight} size="sm" color="textTertiary" />
              </HStack>
            </Pressable>

            <Divider />

            <HStack align="center" gap="md" py="md">
              <IconBadge
                icon={Vibrate}
                tint={colors.avatarPurple}
                size={34}
                shape="rounded"
              />

              <VStack flex={1} gap="xxs">
                <AppText variant="bodyStrong">Vibration</AppText>
                <AppText variant="micro" color="textSecondary">
                  Vibrate on reminder
                </AppText>
              </VStack>

              <RNSwitch
                value={vibration}
                onValueChange={onChangeVibration}
                trackColor={{
                  false: colors.switchBackground,
                  true: colors.brandAccent,
                }}
                thumbColor={colors.card}
                accessibilityRole="switch"
                accessibilityLabel="Vibration"
                accessibilityState={{ checked: vibration }}
              />
            </HStack>

            <Divider />

            <HStack align="center" gap="md" py="md">
              <IconBadge
                icon={CalendarDays}
                tint={colors.success}
                size={34}
                shape="rounded"
              />

              <VStack flex={1} gap="xxs">
                <AppText variant="bodyStrong">Repeat</AppText>
                <AppText variant="micro" color="textSecondary">
                  Select days for reminder
                </AppText>
              </VStack>

              <HStack align="center" gap="xxs">
                {REPEAT_DAYS.map((label, index) => (
                  <RepeatDay
                    key={DAY_NAMES[index]}
                    index={index}
                    label={label}
                    selected={repeatDays.includes(index)}
                    onPress={onToggleDay}
                  />
                ))}
              </HStack>
            </HStack>
          </VStack>
        </Card>
      </VStack>
    );
  },
);

ReminderSettingsCard.displayName = 'ReminderSettingsCard';

const styles = StyleSheet.create({
  day: { width: DAY, height: DAY, borderRadius: radius.sm },
  dayLabel: { fontWeight: '700' },
});
