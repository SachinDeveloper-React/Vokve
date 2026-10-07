import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Check, Lock, type LucideIcon } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

interface Props {
  title: string;
  caption: string;
  /** A second glyph at the end of the line — the shipping page's parcel. */
  trailing?: LucideIcon;
  /** A padlocked word at the end instead — who the payment page is secured by. */
  trailingLabel?: string;
}

const makeStyles = ({ spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    banner: {
      borderRadius: radius.xl,
      borderWidth: 1,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.base,
    },
  });

/**
 * The reassurance at the head of the basket: a green tick and a line that
 * says the order is safe and will arrive. Static — a promise that led
 * somewhere would read as one with conditions.
 */
export const SecureRedemptionBanner = memo(
  ({ title, caption, trailing, trailingLabel }: Props) => {
    const styles = useThemedStyles(makeStyles);
    const { colors, isDark } = useTheme();
    return (
      <HStack
        align="center"
        gap="md"
        style={[
          styles.banner,
          {
            backgroundColor: withAlpha(colors.success, isDark ? 0.16 : 0.08),
            borderColor: withAlpha(colors.success, isDark ? 0.4 : 0.25),
          },
        ]}
      >
        <Icon as={Check} size="md" tint={colors.success} />
        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" style={{ color: colors.success }}>
            {title}
          </AppText>
          <AppText variant="micro" color="textSecondary">
            {caption}
          </AppText>
        </VStack>
        {trailingLabel ? (
          <HStack align="center" gap="xs">
            <Icon as={Lock} size="xs" tint={colors.success} />
            <AppText variant="micro" color="textSecondary">
              {trailingLabel}
            </AppText>
          </HStack>
        ) : trailing ? (
          <Icon as={trailing} size="md" tint={colors.success} />
        ) : null}
      </HStack>
    );
  },
);

SecureRedemptionBanner.displayName = 'SecureRedemptionBanner';
