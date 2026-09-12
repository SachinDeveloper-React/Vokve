import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { formatCoins } from '../../utils/format';
import { VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

/** The ring's outer diameter at the 375pt baseline; five share a row. */
const RING = moderateScale(44);
const CHECK = moderateScale(16);

interface Props {
  days: number;
  coins: number;
  /** Colours the ring. Pass a theme colour. */
  tint: string;
  /** The user's record has reached this many days. */
  achieved: boolean;
}

/**
 * One milestone in the benefits row: a ring with the day count inside and the
 * coins it pays beneath.
 *
 * An achieved ring is filled with a wash of its colour and carries a check
 * on its rim; the ring itself is left as it was. Turning the whole ring green
 * would lose the colour that tells the five apart, and the user still wants
 * to see that the 7-day mark is the green one.
 */
export const StreakMilestone = memo(({ days, coins, tint, achieved }: Props) => {
  const { colors, isDark } = useTheme();
  const fill = achieved ? withAlpha(tint, isDark ? 0.22 : 0.12) : 'transparent';

  return (
    <VStack
      align="center"
      gap="xs"
      flex={1}
      accessible
      accessibilityLabel={`${days} days, ${formatCoins(coins)} coins${
        achieved ? ', achieved' : ''
      }`}
    >
      <View
        style={[styles.ring, { borderColor: tint, backgroundColor: fill }]}
      >
        <AppText variant="bodyStrong" style={{ color: tint }}>
          {days}
        </AppText>

        {achieved ? (
          <View
            style={[
              styles.check,
              { backgroundColor: colors.success, borderColor: colors.card },
            ]}
          >
            <Icon as={Check} size={moderateScale(9)} color="primaryForeground" strokeWidth={3} />
          </View>
        ) : null}
      </View>

      <VStack align="center" gap="none">
        <AppText variant="micro" center>
          {`${days} Days`}
        </AppText>
        <AppText variant="micro" color="textSecondary" center>
          {`+${formatCoins(coins)} Coins`}
        </AppText>
      </VStack>
    </VStack>
  );
});

StreakMilestone.displayName = 'StreakMilestone';

const styles = StyleSheet.create({
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: CHECK,
    height: CHECK,
    borderRadius: CHECK / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
