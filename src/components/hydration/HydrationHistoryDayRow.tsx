import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, ChevronDown, ChevronRight } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { HydrationHistoryDay } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { formatLongDate, formatWeekdayShort } from '../../utils/date';
import { Pressable } from '../form/Pressable';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

const TICK = moderateScale(22);
const BAR_HEIGHT = moderateScale(6);

interface Props {
  day: HydrationHistoryDay;
  expanded: boolean;
  onPress: (date: string) => void;
}

/**
 * One day of the history: what went in, against the goal.
 *
 * A bar rather than a number alone, because the question a reader actually
 * has is "was that a good day?", and that is a comparison — 2.1 L means
 * nothing until you can see where the goal sits. The bar is clipped at the
 * goal rather than scaled to the biggest day, so every row in the list is
 * measured against the same thing and two rows can be compared by eye.
 *
 * A day nobody logged says so instead of reading "0.0 L": zero is a figure,
 * and a day nobody recorded is not the same as a day nobody drank. Those are
 * different facts and a history that conflated them would be lying about the
 * one thing it exists to show.
 */
export const HydrationHistoryDayRow = memo(
  ({ day, expanded, onPress }: Props) => {
    const { colors, isDark } = useTheme();
    const press = useCallback(() => onPress(day.date), [day.date, onPress]);

    const logged = day.entries > 0;
    const fraction = Math.min(1, day.consumedMl / Math.max(1, day.goalMl));
    const tint = day.goalMet ? colors.success : colors.primary;

    return (
      <Pressable
        onPress={press}
        feedback="highlight"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={
          logged
            ? `${formatLongDate(day.date)}, ${(day.consumedMl / 1000).toFixed(1)} litres${
                day.goalMet ? ', goal reached' : ''
              }`
            : `${formatLongDate(day.date)}, nothing logged`
        }
      >
        <HStack align="center" gap="md" py="md">
          <VStack align="center" style={styles.date} gap="xxs">
            <AppText variant="miniMicro" color="textTertiary">
              {formatWeekdayShort(day.date)}
            </AppText>
            <AppText variant="bodyStrong">{day.date.slice(8)}</AppText>
          </VStack>

          <VStack flex={1} gap="xs">
            <HStack align="center" justify="between" gap="sm">
              <AppText variant="body" color={logged ? 'text' : 'textTertiary'}>
                {logged ? `${(day.consumedMl / 1000).toFixed(1)} L` : 'Nothing logged'}
              </AppText>

              {day.goalMet ? (
                <HStack align="center" gap="xxs">
                  <View
                    style={[styles.tick, { backgroundColor: colors.success }]}
                  >
                    <Icon as={Check} size="xs" color="primaryForeground" />
                  </View>
                  <AppText variant="miniMicro" color="success">
                    Goal
                  </AppText>
                </HStack>
              ) : logged ? (
                <AppText variant="miniMicro" color="textTertiary">
                  {day.entries === 1 ? '1 drink' : `${day.entries} drinks`}
                </AppText>
              ) : null}
            </HStack>

            <View
              style={[
                styles.track,
                { backgroundColor: withAlpha(colors.textTertiary, isDark ? 0.22 : 0.12) },
              ]}
            >
              <View
                style={[
                  styles.fill,
                  { width: `${fraction * 100}%`, backgroundColor: tint },
                ]}
              />
            </View>
          </VStack>

          <Icon
            as={expanded ? ChevronDown : ChevronRight}
            size="sm"
            color="textTertiary"
          />
        </HStack>
      </Pressable>
    );
  },
);

HydrationHistoryDayRow.displayName = 'HydrationHistoryDayRow';

const styles = StyleSheet.create({
  date: { width: moderateScale(34) },
  tick: {
    width: TICK,
    height: TICK,
    borderRadius: TICK / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { height: BAR_HEIGHT, borderRadius: radius.sm, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.sm },
});
