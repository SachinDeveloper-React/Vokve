import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { darkColors } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { Challenge } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import { ProgressBar } from '../ui/ProgressBar';
import { CoinAmount } from '../wallet/CoinAmount';
import { METRIC_STYLE, formatProgress } from './metrics';

const DISC_SIZE = moderateScale(40);

interface Props {
  challenge: Challenge;
}

/**
 * One running challenge: what it asks for, how far the user has got, and what
 * finishing it pays.
 *
 * Everything is drawn from the dark palette rather than the active theme. The
 * panel this sits on is dark in light mode too, and light mode's success green
 * — chosen to hold up against white — all but disappears on navy.
 *
 * The progress bar never stands alone: the figure under it says the same thing
 * in words, so a user who cannot judge a bar's fill by eye still knows they
 * are 7,543 steps into 10,000.
 */
export const ActiveChallengeRow = memo(({ challenge }: Props) => {
  const { tint } = METRIC_STYLE[challenge.metric];
  const color = darkColors[tint];
  const foreground = darkColors.tierForeground;

  return (
    <HStack
      align="center"
      gap="md"
      accessible
      accessibilityLabel={`${challenge.title}. ${formatProgress(
        challenge.progress,
        challenge.goal,
        challenge.metric,
      )}. Pays ${challenge.rewardCoins} coins${
        challenge.rewardsBadge ? ' and a special badge' : ''
      }`}
    >
      <View
        style={[
          styles.disc,
          { backgroundColor: withAlpha(foreground, 0.12) },
        ]}
      >
        <Emoji size="sm">{challenge.emoji}</Emoji>
      </View>

      <VStack flex={1} gap="xs">
        <VStack gap="xxs">
          <AppText
            variant="bodyStrong"
            numberOfLines={1}
            style={{ color: foreground }}
          >
            {challenge.title}
          </AppText>
          <AppText
            variant="micro"
            numberOfLines={1}
            style={{ color: withAlpha(foreground, 0.64) }}
          >
            {challenge.description}
          </AppText>
        </VStack>

        <ProgressBar
          progress={challenge.progress / challenge.goal}
          tint={color}
        />

        <AppText variant="micro" style={{ color }}>
          {formatProgress(challenge.progress, challenge.goal, challenge.metric)}
        </AppText>
      </VStack>

      <VStack
        align="start"
        gap="xxs"
        px="sm"
        py="sm"
        style={[styles.reward, { backgroundColor: withAlpha(foreground, 0.1) }]}
      >
        <CoinAmount
          amount={challenge.rewardCoins}
          size="sm"
          tint={darkColors.gold}
          withUnit
        />
        {challenge.rewardsBadge ? (
          <AppText
            variant="miniMicro"
            numberOfLines={1}
            style={{ color: withAlpha(foreground, 0.64) }}
          >
            + Special Badge
          </AppText>
        ) : null}
      </VStack>
    </HStack>
  );
});

ActiveChallengeRow.displayName = 'ActiveChallengeRow';

const styles = StyleSheet.create({
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The chip hugs its own content: a reward that flexed with the row would
  // leave the three of them different widths down the card.
  reward: { borderRadius: moderateScale(12), flexShrink: 0 },
});
