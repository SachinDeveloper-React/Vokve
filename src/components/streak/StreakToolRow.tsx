import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  icon: LucideIcon;
  /** Colours the glyph and the trailing value. Pass a theme colour. */
  tint: string;
  title: string;
  subtitle: string;
  /** What the tool costs or how many are left — "1 Available", "50 Coins". */
  value: string;
  /** Draws the row on a wash of its tint, for the one tool being pushed. */
  highlighted?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/**
 * One tool in the streak toolbox.
 *
 * The value on the right is in the tint and the title is not: the title says
 * what the tool is, which the user reads once, and the value says whether
 * they can use it right now, which is what they came to check.
 */
export const StreakToolRow = memo(
  ({ icon, tint, title, subtitle, value, highlighted = false, disabled = false, onPress }: Props) => {
    const { isDark } = useTheme();

    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        feedback="highlight"
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${value}. ${subtitle}`}
        accessibilityState={{ disabled }}
        style={disabled && styles.disabled}
      >
        <HStack
          align="center"
          gap="md"
          px="md"
          py="md"
          radius="lg"
          style={
            highlighted && {
              backgroundColor: withAlpha(tint, isDark ? 0.16 : 0.1),
            }
          }
        >
          <Icon as={icon} size="sm" tint={tint} />

          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong" numberOfLines={1}>
              {title}
            </AppText>
            <AppText variant="micro" color="textSecondary" numberOfLines={2}>
              {subtitle}
            </AppText>
          </VStack>

          <HStack align="center" gap="xxs">
            <AppText variant="micro" style={{ color: tint }}>
              {value}
            </AppText>
            <Icon as={ChevronRight} size="xs" tint={tint} />
          </HStack>
        </HStack>
      </Pressable>
    );
  },
);

StreakToolRow.displayName = 'StreakToolRow';

const styles = StyleSheet.create({
  disabled: { opacity: 0.5 },
});
