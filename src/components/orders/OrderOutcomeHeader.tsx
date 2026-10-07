import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

const DISC = moderateScale(72);

interface Props {
  icon: LucideIcon;
  /** The disc's fill; the glyph is dropped out in white on it. */
  tint: string;
  title: string;
  message: string;
}

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    block: { paddingTop: spacing.lg, paddingBottom: spacing.base },
    disc: {
      width: DISC,
      height: DISC,
      borderRadius: DISC / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    center: { textAlign: 'center' },
  });

/**
 * How an order came out, at the head of the confirmation page: one large
 * glyph on a solid disc, the verdict, and a line of what happens next.
 *
 * The disc's colour is the whole message at a glance — green for placed,
 * amber for money still owing — so a member who reads nothing else still
 * knows whether they are done.
 */
export const OrderOutcomeHeader = memo(
  ({ icon, tint, title, message }: Props) => {
    const styles = useThemedStyles(makeStyles);
    const { colors } = useTheme();
    return (
      <VStack align="center" gap="md" style={styles.block}>
        <HStack
          align="center"
          justify="center"
          style={[styles.disc, { backgroundColor: tint }]}
        >
          <Icon
            as={icon}
            size={moderateScale(36)}
            tint={colors.primaryForeground}
          />
        </HStack>
        <VStack align="center" gap="xs">
          <AppText variant="h1" accessibilityRole="header" style={styles.center}>
            {title}
          </AppText>
          <AppText variant="caption" color="textSecondary" style={styles.center}>
            {message}
          </AppText>
        </VStack>
      </VStack>
    );
  },
);

OrderOutcomeHeader.displayName = 'OrderOutcomeHeader';
