import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { AlertTriangle, ChevronRight } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  /** Days the streak is missing, from the server's restore gap. */
  missedDays: number;
  /** Jumps to the two tools that can still cover them. */
  onPress: () => void;
}

/**
 * The warning between the calendar and the tools: the streak has a hole in
 * it, and there is still something to be done about it.
 *
 * It appears only while the server says a restore would bridge something
 * (RULES S6) — a gap older than the window is not a call to action, it is
 * history, and a banner offering to fix it would be offering nothing.
 */
export const StreakGapAlert = memo(({ missedDays, onPress }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      feedback="opacity"
      accessibilityRole="button"
      accessibilityLabel={`${missedDays} ${
        missedDays === 1 ? 'day' : 'days'
      } missed. Use a freeze or a restore to keep your streak alive.`}
    >
      <Box
        p="base"
        style={[
          styles.panel,
          {
            backgroundColor: withAlpha(colors.destructive, isDark ? 0.16 : 0.08),
            borderColor: withAlpha(colors.destructive, 0.4),
          },
        ]}
      >
        <HStack align="center" gap="md">
          <Icon as={AlertTriangle} size="sm" tint={colors.destructive} />

          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong" style={{ color: colors.destructive }}>
              {`${missedDays} ${missedDays === 1 ? 'day' : 'days'} missed`}
            </AppText>
            <AppText variant="micro" color="textSecondary">
              Use Freeze or Restore to keep your streak alive.
            </AppText>
          </VStack>

          <Icon as={ChevronRight} size="sm" color="textSecondary" />
        </HStack>
      </Box>
    </Pressable>
  );
});

StreakGapAlert.displayName = 'StreakGapAlert';

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
