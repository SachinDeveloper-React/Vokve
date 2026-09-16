import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing, useTheme } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';

interface Props {
  /**
   * Coins per qualifying friend, as the server states it (RULES F3). Null
   * before the first sync, when the line stays generic rather than naming
   * a figure the app made up.
   */
  inviterCoins?: number | null;
}

/**
 * The pitch, in two lines and a sentence.
 *
 * On the page rather than in a card: it is the screen's own headline, and a
 * card would make it look like one section among the four under it. The
 * coins are decoration and are hidden from the screen reader as such.
 */
export const ReferralHeroBanner = memo(({ inviterCoins = null }: Props) => {
  const { colors } = useTheme();

  return (
    <HStack align="center" gap="base">
      <VStack flex={1} gap="xs">
        <VStack gap="none">
          <AppText variant="h1">Invite More,</AppText>
          <AppText variant="h1" style={{ color: colors.brandAccent }}>
            Earn More
          </AppText>
        </VStack>

        <AppText variant="micro" color="textSecondary" numberOfLines={2}>
          {inviterCoins !== null
            ? `Share your code and earn ${inviterCoins} coins for every friend who joins and works out.`
            : 'Share your code, friends join and you both get rewarded!'}
        </AppText>
      </VStack>

      <View
        style={styles.coins}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Emoji size="lg">🪙</Emoji>
        <View style={styles.offset}>
          <Emoji size="md">🪙</Emoji>
        </View>
      </View>
    </HStack>
  );
});

ReferralHeroBanner.displayName = 'ReferralHeroBanner';

const styles = StyleSheet.create({
  coins: { alignItems: 'flex-end', gap: spacing.md, paddingRight: spacing.sm },
  offset: { marginRight: -spacing.lg },
});
