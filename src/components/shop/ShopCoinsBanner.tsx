import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { ChevronRight, Gem } from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { formatCoins } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';
import { CoinBadge } from '../wallet/CoinBadge';
import { RewardPill } from '../wallet/RewardPill';

interface Props {
  balance: number;
  onPressBestRewards: () => void;
}

/**
 * The shop's hero: what the user has to spend, and where the good stuff is.
 *
 * Two halves on one dark panel rather than two cards. The balance is the
 * number every price below is measured against, and "Best Rewards" is the
 * shortcut for a shopper who does not want to browse — putting them side by
 * side says, in one glance, "you have this; here is what it buys".
 *
 * Only the right half is pressable. The balance is a figure, not a link:
 * the wallet is a tab away and a tap here that jumped there would pull the
 * user out of the shop they just opened.
 */
export const ShopCoinsBanner = memo(
  ({ balance, onPressBestRewards }: Props) => {
    const { colors } = useTheme();
    const foreground = colors.tierForeground;
    const secondary = withAlpha(foreground, 0.7);

    return (
      <LinearGradient
        colors={colors.gradient.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.panel}
      >
        {/* `align="stretch"` lets the rule between the halves take the row's height. */}
        <HStack align="stretch" gap="md" style={{ padding: spacing.lg }}>
          <VStack flex={5} gap="sm">
            <HStack align="center" gap="md">
              <CoinBadge tint={darkColors.gold} size={44} />

              <VStack gap="xxs">
                <AppText variant="label" style={{ color: secondary }}>
                  Your Coins
                </AppText>
                <AppText
                  variant="metric"
                  numberOfLines={1}
                  style={{ color: foreground }}
                >
                  {formatCoins(balance)}
                </AppText>
              </VStack>
            </HStack>

            <RewardPill surface="overlay" />
          </VStack>

          <Divider orientation="vertical" tint={colors.overlayMedium} />

          <Pressable
            onPress={onPressBestRewards}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel="Best Rewards. Top quality products, curated for you"
            style={styles.bestRewards}
          >
            <HStack align="center" gap="sm" flex={1}>
              <IconBadge
                icon={Gem}
                tint={foreground}
                size={40}
                variant="outline"
              />

              <VStack flex={1} gap="xxs">
                <AppText
                  variant="bodyStrong"
                  numberOfLines={1}
                  style={{ color: foreground }}
                >
                  Best Rewards
                </AppText>
                <AppText
                  variant="micro"
                  numberOfLines={2}
                  style={{ color: secondary }}
                >
                  Top quality products, curated for you.
                </AppText>
              </VStack>

              <Icon as={ChevronRight} size="sm" tint={secondary} />
            </HStack>
          </Pressable>
        </HStack>
      </LinearGradient>
    );
  },
);

ShopCoinsBanner.displayName = 'ShopCoinsBanner';

/**
 * `Box` has no gradient, so the panel's own padding and rounding go on the
 * `LinearGradient`; and `Pressable` is not a `Box`, so its share of the row
 * has to be given as a style.
 */
const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  bestRewards: { flex: 4 },
});
