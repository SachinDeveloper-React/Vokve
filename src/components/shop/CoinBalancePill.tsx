import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronRight, Coins } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { formatCoins } from '../../utils/format';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  /** Whole coins; a fraction is floored, as the till floors it. */
  balance: number;
  onPress: () => void;
}

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    pill: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.sm,
      paddingLeft: spacing.md,
      paddingRight: spacing.sm,
    },
  });

/**
 * The wallet balance in a page's top corner, so a shopper deciding what to
 * spend sees what they have without leaving; the tap goes to the wallet.
 */
export const CoinBalancePill = memo(({ balance, onPress }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const whole = Math.floor(balance);
  return (
    <Pressable
      onPress={onPress}
      feedback="opacity"
      accessibilityRole="button"
      accessibilityLabel={`${formatCoins(whole)} coins, open wallet`}
    >
      <HStack align="center" gap="xs" style={styles.pill}>
        <Icon as={Coins} size="sm" tint={colors.brandAccent} />
        <AppText variant="bodyStrong">{formatCoins(whole)}</AppText>
        <Icon as={ChevronRight} size="xs" color="textSecondary" />
      </HStack>
    </Pressable>
  );
});

CoinBalancePill.displayName = 'CoinBalancePill';
