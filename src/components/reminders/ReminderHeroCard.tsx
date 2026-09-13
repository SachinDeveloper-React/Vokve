import React, { memo } from 'react';
import { StyleSheet, Switch as RNSwitch, View } from 'react-native';
import { Clock } from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { formatTimeOfDay } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { WaterDroplet } from '../fitness/WaterDroplet';

interface Props {
  enabled: boolean;
  /** How many times will actually arrive today. */
  activeCount: number;
  /** `HH:mm`, or null when nothing is due. */
  nextTime: string | null;
  onChange: (enabled: boolean) => void;
}

/**
 * The master switch, and what it is currently promising.
 *
 * On the screen's one dark panel, the same surface the challenge board's
 * running list uses, because it plays the same part: the thing that is live
 * right now, above the settings that shape it.
 *
 * The count beside the switch is the honest one — it goes to zero the moment
 * the switch is off, rather than continuing to state how many rows the plan
 * holds. A screen that says "7 reminders active" under a switch that is off is
 * a screen nobody trusts twice.
 */
export const ReminderHeroCard = memo(
  ({ enabled, activeCount, nextTime, onChange }: Props) => {
    const { colors } = useTheme();
    const foreground = darkColors.tierForeground;
    const secondary = withAlpha(foreground, 0.68);

    return (
      <View style={[styles.panel, { backgroundColor: colors.tierBackground }]}>
        <HStack align="center" gap="base">
          <WaterDroplet size={44} />

          <VStack flex={1} gap="xs">
            <AppText
              variant="bodyStrong"
              numberOfLines={1}
              style={{ color: foreground }}
            >
              Hydration Reminder
            </AppText>
            <AppText variant="micro" numberOfLines={2} style={{ color: secondary }}>
              Get reminded to drink water at the right time.
            </AppText>
          </VStack>

          <VStack align="end" gap="xs">
            <HStack align="center" gap="sm">
              <RNSwitch
                value={enabled}
                onValueChange={onChange}
                trackColor={{
                  false: withAlpha(foreground, 0.24),
                  true: colors.brandAccent,
                }}
                thumbColor={foreground}
                accessibilityRole="switch"
                accessibilityLabel="Hydration reminders"
                accessibilityState={{ checked: enabled }}
              />
            </HStack>

            <AppText
              variant="miniMicro"
              numberOfLines={1}
              style={{ color: colors.brandAccent }}
            >
              {`${activeCount} ${
                activeCount === 1 ? 'reminder' : 'reminders'
              } active`}
            </AppText>
          </VStack>
        </HStack>

        <HStack align="center" justify="end" gap="sm">
          <AppText variant="micro" numberOfLines={1} style={{ color: secondary }}>
            Next Reminder
          </AppText>
          <Icon as={Clock} size="xs" tint={foreground} />
          <AppText
            variant="bodyStrong"
            numberOfLines={1}
            style={{ color: foreground }}
          >
            {nextTime === null ? 'None scheduled' : formatTimeOfDay(nextTime)}
          </AppText>
        </HStack>
      </View>
    );
  },
);

ReminderHeroCard.displayName = 'ReminderHeroCard';

const styles = StyleSheet.create({
  panel: { borderRadius: radius.xl, padding: spacing.base, gap: spacing.base },
});
