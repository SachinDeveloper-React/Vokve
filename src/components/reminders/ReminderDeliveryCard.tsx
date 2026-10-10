import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { BellOff, BellRing, Clock3, HeartOff, MoonStar } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Pressable } from '../form/Pressable';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';

interface Props {
  allowed: boolean;
  healthOn: boolean;
  exact: boolean;
  scheduled: number;
  /** Times that fall inside quiet hours and so will not ring (RULES Y6). */
  quietCount: number;
  /** "22:00–07:00", or null when the window is off. */
  quietLabel: string | null;
  checking: boolean;
  onAllow: () => void;
  onEnableHealth: () => void;
  onOpenExactAlarms: () => void;
  onOpenQuietHours: () => void;
}

/**
 * Whether the reminders above this card will actually arrive, and the one
 * tap that fixes it when they will not.
 *
 * A reminder plan is the one setting in the app whose whole value is in the
 * future: there is no way for the user to tell whether it works except to
 * wait for a time to pass and see. So the screen has to say it, and say it
 * where the plan is — not leave the user to discover at 7 a.m. that the
 * permission they refused weeks ago has been quietly swallowing every
 * reminder since.
 *
 * One problem at a time, the most blocking first: there is no point offering
 * exact alarms to someone whose notifications are switched off, and a card
 * that listed four faults at once would read as a broken app rather than a
 * setting to change. Fixing one reveals the next.
 *
 * The order is deliberate. Health off and a refused permission silence
 * everything; quiet hours silence only some times, and inexact alarms
 * silence nothing — they only move a reminder by a few minutes.
 */
export const ReminderDeliveryCard = memo(
  ({
    allowed,
    healthOn,
    exact,
    scheduled,
    quietCount,
    quietLabel,
    checking,
    onAllow,
    onEnableHealth,
    onOpenExactAlarms,
    onOpenQuietHours,
  }: Props) => {
    const { colors, isDark } = useTheme();

    if (checking) return null;

    const problem = !healthOn
      ? {
          icon: HeartOff,
          tint: colors.warning,
          title: 'Health reminders are switched off',
          message:
            'Your plan is saved, but Vokve will not send hydration reminders until you allow health notifications.',
          action: 'Turn on',
          onPress: onEnableHealth,
        }
      : !allowed
        ? {
            icon: BellOff,
            tint: colors.destructive,
            title: 'Notifications are blocked',
            message:
              'This phone will not show Vokve notifications, so no reminder can arrive. Allow them to start reminding you.',
            action: 'Allow',
            onPress: onAllow,
          }
        : quietCount > 0 && quietLabel !== null
          ? {
              icon: MoonStar,
              tint: colors.warning,
              title:
                quietCount === 1
                  ? `1 time is inside your quiet hours`
                  : `${quietCount} times are inside your quiet hours`,
              message: `Nothing is sent between ${quietLabel}, so those will not ring. Change the window, or move the times outside it.`,
              action: 'Quiet hours',
              onPress: onOpenQuietHours,
            }
          : !exact
            ? {
                icon: Clock3,
                tint: colors.warning,
                title: 'Reminders may be a few minutes late',
                message:
                  'Android is batching this app’s alarms. Allow exact alarms and every reminder arrives on its minute.',
                action: 'Allow exact alarms',
                onPress: onOpenExactAlarms,
              }
            : null;

    if (problem === null) {
      if (scheduled === 0) return null;
      return (
        <Box
          radius="xl"
          p="base"
          style={{ backgroundColor: withAlpha(colors.success, isDark ? 0.18 : 0.1) }}
        >
          <HStack align="center" gap="md">
            <Icon as={BellRing} size="sm" color="success" />
            <AppText variant="micro" color="textSecondary" style={styles.line}>
              {scheduled === 1
                ? 'This phone is set to ring 1 reminder, even offline.'
                : `This phone is set to ring ${scheduled} reminders, even offline.`}
            </AppText>
          </HStack>
        </Box>
      );
    }

    return (
      <Box
        radius="xl"
        p="base"
        style={{ backgroundColor: withAlpha(problem.tint, isDark ? 0.2 : 0.1) }}
      >
        <HStack align="center" gap="md">
          <IconBadge icon={problem.icon} tint={problem.tint} size={34} shape="rounded" />

          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong">{problem.title}</AppText>
            <AppText variant="micro" color="textSecondary">
              {problem.message}
            </AppText>
          </VStack>
        </HStack>

        <Pressable
          onPress={problem.onPress}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel={problem.action}
        >
          <HStack justify="end" pt="sm">
            <AppText variant="bodyStrong" style={{ color: problem.tint }}>
              {problem.action}
            </AppText>
          </HStack>
        </Pressable>
      </Box>
    );
  },
);

ReminderDeliveryCard.displayName = 'ReminderDeliveryCard';

const styles = StyleSheet.create({
  line: { flex: 1 },
});
