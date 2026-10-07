import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  icon: LucideIcon;
  title: string;
  /** A link at the heading's end — "Manage". */
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.base,
      gap: spacing.md,
    },
    action: { color: colors.brandAccent, fontWeight: '600' },
    grow: { flex: 1 },
  });

/**
 * A panel of the shipping page: a glyph and a heading in the brand orange's
 * company, an optional link at the end, and what the section holds.
 */
export const ShippingSection = memo(
  ({ icon, title, action, children }: Props) => {
    const styles = useThemedStyles(makeStyles);
    const { colors } = useTheme();
    return (
      <VStack style={styles.card}>
        <HStack align="center" gap="sm">
          <Icon as={icon} size="md" tint={colors.brandAccent} />
          <AppText variant="h3" accessibilityRole="header" style={styles.grow}>
            {title}
          </AppText>
          {action ? (
            <Pressable
              onPress={action.onPress}
              feedback="opacity"
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              <AppText variant="caption" style={styles.action}>
                {action.label}
              </AppText>
            </Pressable>
          ) : null}
        </HStack>
        {children}
      </VStack>
    );
  },
);

ShippingSection.displayName = 'ShippingSection';
