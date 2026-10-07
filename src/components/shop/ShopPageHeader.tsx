import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';
import { CoinBalancePill } from './CoinBalancePill';

interface Props {
  title: string;
  subtitle: string;
  /** The wallet, in the corner; the pill opens it. */
  balance: number;
  onPressBack: () => void;
  onPressBalance: () => void;
}

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    header: { paddingTop: spacing.sm, paddingBottom: spacing.md },
    back: { width: 32 },
  });

/**
 * The masthead of a page pushed from the shop — the product, the basket:
 * a way back, the page's name centred with a line under it, and the coin
 * balance in the corner, because every one of these pages is about
 * spending it.
 */
export const ShopPageHeader = memo(
  ({ title, subtitle, balance, onPressBack, onPressBalance }: Props) => {
    const styles = useThemedStyles(makeStyles);
    return (
      <HStack align="center" gap="sm" style={styles.header}>
        <Pressable
          onPress={onPressBack}
          feedback="opacity"
          visualSize={24}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
        >
          <Icon as={ChevronLeft} size="lg" color="text" />
        </Pressable>
        <VStack flex={1} align="center" gap="xxs">
          <AppText variant="h2" accessibilityRole="header" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="micro" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </AppText>
        </VStack>
        <CoinBalancePill balance={balance} onPress={onPressBalance} />
      </HStack>
    );
  },
);

ShopPageHeader.displayName = 'ShopPageHeader';
