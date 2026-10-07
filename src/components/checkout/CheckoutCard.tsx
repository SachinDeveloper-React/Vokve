import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  title: string;
  /** A glyph before the heading, in the brand orange; the address panel's pin. */
  icon?: LucideIcon;
  /** A link at the heading's end — "Change", "Edit Cart". */
  action?: {
    label: string;
    onPress: () => void;
    /** What a screen reader says, when the label alone is not enough. */
    accessibilityLabel?: string;
  };
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
 * One panel of the till: a heading, an optional link at its end, and the
 * panel's contents. The three the checkout is made of — where it goes,
 * what is in it, what it costs — share this chrome so the page reads as
 * one column of cards rather than three differently built boxes.
 */
export const CheckoutCard = memo(({ title, icon, action, children }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <VStack style={styles.card}>
      <HStack align="center" gap="sm">
        {icon ? <Icon as={icon} size="md" tint={colors.brandAccent} /> : null}
        <AppText variant="h3" accessibilityRole="header" style={styles.grow}>
          {title}
        </AppText>
        {action ? (
          <Pressable
            onPress={action.onPress}
            feedback="opacity"
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}
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
});

CheckoutCard.displayName = 'CheckoutCard';
