import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

interface Props {
  /** The server's wording (⚙ `commerce.deliveryNotice`). */
  text: string;
}

const makeStyles = ({ spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    note: {
      borderRadius: radius.lg,
      borderWidth: 1,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.base,
    },
    grow: { flex: 1 },
  });

/** A line of what to expect from the courier, in the info blue: told, not warned. */
export const DeliveryNotice = memo(({ text }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  return (
    <HStack
      align="center"
      gap="md"
      style={[
        styles.note,
        {
          backgroundColor: withAlpha(colors.primary, isDark ? 0.12 : 0.06),
          borderColor: withAlpha(colors.primary, isDark ? 0.35 : 0.2),
        },
      ]}
    >
      <Icon as={Info} size="sm" tint={colors.primary} />
      <AppText variant="micro" color="textSecondary" style={styles.grow}>
        {text}
      </AppText>
    </HStack>
  );
});

DeliveryNotice.displayName = 'DeliveryNotice';
