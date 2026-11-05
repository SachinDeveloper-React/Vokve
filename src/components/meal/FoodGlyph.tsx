import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { Box } from '../layout/Box';
import { AppImage } from '../media/AppImage';
import { Emoji, type EmojiSize } from '../media/Emoji';

interface Props {
  /** The food's photograph, where the operator uploaded one. */
  imageUrl?: string | null;
  /** Always present, and always the fallback. */
  emoji: string;
  /** The disc's diameter, unscaled — the caller's own measurement. */
  size?: number;
  emojiSize?: EmojiSize;
}

/**
 * A food's picture, or the emoji that has always stood in for it.
 *
 * One component rather than the same two branches in four row files,
 * because the fallback is the interesting half and it has to be identical
 * everywhere: almost no food has a photograph, and a list that drew a grey
 * square for the ones that do not would look broken rather than plain.
 *
 * The disc keeps its size whichever is drawn. An image that resized the row
 * it landed in would make a library jump about as it scrolled past the one
 * food in fifty that has a photograph.
 */
export const FoodGlyph = memo(
  ({ imageUrl, emoji, size = moderateScale(40), emojiSize = 'sm' }: Props) => {
    const { colors } = useTheme();
    const disc = { width: size, height: size };

    if (imageUrl) {
      return (
        <AppImage
          uri={imageUrl}
          width={size}
          height={size}
          radius="pill"
          fallback={
            <Box radius="pill" style={[styles.centre, disc, { backgroundColor: colors.muted }]}>
              <Emoji size={emojiSize}>{emoji}</Emoji>
            </Box>
          }
        />
      );
    }

    return (
      <Box radius="pill" style={[styles.centre, disc, { backgroundColor: colors.muted }]}>
        <Emoji size={emojiSize}>{emoji}</Emoji>
      </Box>
    );
  },
);

FoodGlyph.displayName = 'FoodGlyph';

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
