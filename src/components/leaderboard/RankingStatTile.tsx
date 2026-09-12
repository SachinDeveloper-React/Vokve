import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { radius, useTheme } from '../../theme';
import { VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';

interface Props {
  emoji: string;
  /** What the figure is — "Best Rank". */
  label: string;
  /** The figure itself, already formatted. */
  value: string;
  /** What qualifies it — "This Month", "Coins Earned". */
  caption: string;
}

/**
 * One figure in the rankings strip.
 *
 * Outlined rather than filled: four washed tiles in a row would be the
 * loudest thing on a screen whose subject is the board above them, and the
 * outline is enough to say the four are separate readouts.
 *
 * Aligned to the start rather than left to stretch. `Emoji` centres its glyph
 * inside whatever width it is given, so a stretched column put the emoji in the
 * middle of the tile with the three lines under it hard against the left edge.
 */
export const RankingStatTile = memo(
  ({ emoji, label, value, caption }: Props) => {
    const { colors } = useTheme();

    return (
      <VStack
        flex={1}
        align="start"
        gap="xxs"
        p="sm"
        style={[styles.tile, { borderColor: colors.border }]}
        accessible
        accessibilityLabel={`${label}, ${value}, ${caption}`}
      >
        <Emoji size="sm">{emoji}</Emoji>

        <AppText variant="miniMicro" color="textSecondary" numberOfLines={2}>
          {label}
        </AppText>

        <AppText variant="h3" numberOfLines={1}>
          {value}
        </AppText>

        <AppText variant="miniMicro" color="textTertiary" numberOfLines={2}>
          {caption}
        </AppText>
      </VStack>
    );
  },
);

RankingStatTile.displayName = 'RankingStatTile';

const styles = StyleSheet.create({
  tile: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
