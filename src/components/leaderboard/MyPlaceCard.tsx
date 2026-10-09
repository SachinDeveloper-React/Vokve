import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import type { LeaderboardBoard } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { formatGrouped } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { CoinAmount } from '../wallet/CoinAmount';

interface Props {
  /** The caller's place this week; null until they have scored. */
  me: LeaderboardBoard['me'];
  /** How many have a score this week — what the rank is out of. */
  ranked: number;
}

/**
 * Where the reader stands, above the board rather than buried in it.
 *
 * A member outside the top places has to scroll past everyone ahead of them
 * to find their own row, which is the one row they opened the screen for. It
 * is still in the list below — this does not replace it, it answers the
 * question first.
 *
 * The coins figure is what the place would pay if the week closed now, not
 * what has been paid: the week is live, and a number presented as banked that
 * a Sunday walk could take away would be a promise the server never made.
 */
export const MyPlaceCard = memo(({ me, ranked }: Props) => {
  const { colors } = useTheme();
  const foreground = darkColors.tierForeground;
  const secondary = withAlpha(foreground, 0.7);

  if (me === null) {
    return (
      <LinearGradient
        colors={colors.gradient.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.panel}
      >
        <VStack gap="xxs" p="base">
          <AppText variant="label" style={{ color: secondary }}>
            Your place
          </AppText>
          <AppText variant="h3" style={{ color: foreground }}>
            Not on the board yet
          </AppText>
          <AppText variant="micro" style={{ color: secondary }}>
            Walk, train and finish challenges this week to take a place.
          </AppText>
        </VStack>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={colors.gradient.hero}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.panel}
    >
      <HStack
        align="center"
        gap="base"
        p="base"
        accessible
        accessibilityLabel={`Your place: rank ${me.rank} of ${ranked}, ${formatGrouped(
          me.score,
        )} points, top ${me.percentile} percent. Worth ${me.coins} coins if the week ended now.`}
      >
        <VStack gap="xxs">
          <AppText variant="label" style={{ color: secondary }}>
            Your place
          </AppText>
          <AppText variant="display" style={{ color: foreground }}>
            {`#${formatGrouped(me.rank)}`}
          </AppText>
        </VStack>

        <VStack flex={1} gap="xs">
          <AppText variant="bodyStrong" style={{ color: foreground }}>
            {`${formatGrouped(me.score)} points`}
          </AppText>
          <AppText variant="micro" style={{ color: secondary }}>
            {`Top ${me.percentile}% of ${formatGrouped(ranked)} ranked`}
          </AppText>
          <HStack align="center" gap="xs">
            <CoinAmount amount={me.coins} size="sm" tint={darkColors.gold} />
            <AppText variant="miniMicro" style={{ color: secondary }}>
              if the week ended now
            </AppText>
          </HStack>
        </VStack>
      </HStack>
    </LinearGradient>
  );
});

MyPlaceCard.displayName = 'MyPlaceCard';

const styles = StyleSheet.create({
  panel: { borderRadius: radius.xl, overflow: 'hidden', padding: spacing.none },
});
