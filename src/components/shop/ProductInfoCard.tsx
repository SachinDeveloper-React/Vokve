import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

export interface ProductInfoRow {
  icon: LucideIcon;
  label: string;
  value: string;
}

interface Props {
  rows: readonly ProductInfoRow[];
}

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.base,
    },
    row: { paddingVertical: spacing.sm },
    label: { flexShrink: 0, maxWidth: '45%' },
    value: { flex: 1, textAlign: 'right' },
  });

/**
 * "Product Information": a glyph and a label on the left, the value set
 * flush right, one fact a row. A long value wraps under itself rather than
 * pushing into the label.
 */
export const ProductInfoCard = memo(({ rows }: Props) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <VStack style={styles.card}>
      {rows.map(row => (
        <HStack
          key={row.label}
          align="center"
          gap="md"
          style={styles.row}
          accessible
          accessibilityLabel={`${row.label}: ${row.value}`}
        >
          <HStack align="center" gap="sm" style={styles.label}>
            <Icon as={row.icon} size="sm" color="textSecondary" />
            <AppText variant="caption" color="textSecondary">
              {row.label}
            </AppText>
          </HStack>
          <AppText variant="caption" style={styles.value}>
            {row.value}
          </AppText>
        </HStack>
      ))}
    </VStack>
  );
});

ProductInfoCard.displayName = 'ProductInfoCard';
