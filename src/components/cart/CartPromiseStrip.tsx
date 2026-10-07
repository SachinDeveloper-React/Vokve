import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import {
  Check,
  Package,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react-native';
import {
  fontWeight,
  useTheme,
  useThemedStyles,
  type ThemeShape,
} from '../../theme';
import type { PaymentMode } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

interface Props {
  mode: PaymentMode;
  /** ⚙ `commerce.deliveryEstimate`; a general line when the server sends none. */
  deliveryEstimate: string | null;
  /** ⚙ `commerce.returnPolicy`; a general line when the server sends none. */
  returnPolicy: string | null;
}

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.base,
      paddingHorizontal: spacing.sm,
    },
    cell: { flex: 1 },
    title: { fontWeight: fontWeight.semibold, textAlign: 'center' },
    caption: { textAlign: 'center' },
  });

const PAYMENT_CAPTION: Record<PaymentMode, string> = {
  coins: '100% safe coins',
  money: '100% secure payments',
  mixed: 'Coins and payments secured',
};

/**
 * Three promises under the basket — paying, delivery, returns — each a
 * glyph over a word over a line. The delivery and returns lines are the
 * server's own wording, the same the product page shows, so the two pages
 * never promise different things.
 */
export const CartPromiseStrip = memo(
  ({ mode, deliveryEstimate, returnPolicy }: Props) => {
    const styles = useThemedStyles(makeStyles);
    const { colors } = useTheme();
    const promises: { icon: LucideIcon; title: string; caption: string }[] = [
      { icon: Check, title: 'Secure Payment', caption: PAYMENT_CAPTION[mode] },
      {
        icon: Package,
        title: 'Fast Delivery',
        caption: deliveryEstimate ?? 'Quick and reliable shipping',
      },
      {
        icon: RefreshCw,
        title: 'Easy Returns',
        caption: returnPolicy ?? 'Hassle-free returns',
      },
    ];
    return (
      <HStack align="start" style={styles.card}>
        {promises.map(promise => (
          <VStack
            key={promise.title}
            align="center"
            gap="xs"
            style={styles.cell}
            accessible
            accessibilityLabel={`${promise.title}: ${promise.caption}`}
          >
            <Icon as={promise.icon} size="md" tint={colors.success} />
            <AppText variant="micro" style={styles.title} numberOfLines={1}>
              {promise.title}
            </AppText>
            <AppText
              variant="micro"
              color="textTertiary"
              style={styles.caption}
              numberOfLines={2}
            >
              {promise.caption}
            </AppText>
          </VStack>
        ))}
      </HStack>
    );
  },
);

CartPromiseStrip.displayName = 'CartPromiseStrip';
