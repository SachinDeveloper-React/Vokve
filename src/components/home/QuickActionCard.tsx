import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Emoji } from '../media/Emoji';
import { VStack } from '../layout/Stack';
import { Pressable } from '../form/Pressable';

interface Props {
  /** The glyph at the top of the tile, e.g. `🏆`. */
  emoji: string;
  /** Colour of the second line. Pass a theme token, not a literal. */
  tint: string;
  /** The first line, in the card's own colour. */
  title: string;
  /** The second line, in the tint — "achievements", "7 days". */
  detail?: string;
  /**
   * `false` keeps the detail's own casing. A value reads wrong shouted:
   * "7 DAYS" looks like a heading, "7 Days" like the number it is.
   */
  uppercaseDetail?: boolean;
  onPress: () => void;
}

/**
 * Four cards share the width of the screen, so a label has roughly 70pt to sit
 * in on a 375pt phone and less than 60pt on a small one. Shrinking the odd long
 * word a fraction is better than truncating it: "achievements" is the word on
 * the tile that says what the shortcut opens, and "ACHIEVEM…" does not.
 */
const FIT_LABEL = {
  numberOfLines: 1,
  // adjustsFontSizeToFit: true,
  minimumFontScale: 0.8,
} as const;

/**
 * One shortcut tile: an emoji over two lines of label.
 *
 * The tint is spent on the second line only. Colouring the whole title would
 * put four differently-coloured blocks of text in one row and leave nothing for
 * the eye to scan down; keeping the first line neutral means the four titles
 * read as one list and the colour reads as a category.
 *
 * An emoji rather than a tinted line icon: at this size a stroked glyph in a
 * single colour is close to unreadable, while the emoji's own colours carry the
 * shape — and it ships no asset.
 */
export const QuickActionCard = memo(
  ({ emoji, tint, title, detail, uppercaseDetail = true, onPress }: Props) => (
    <Pressable
      onPress={onPress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title} ${detail}` : title}
    >
      <Card elevation="low" radius="xl" style={styles.card}>
        <VStack align="center" gap="sm">
          <Emoji size="md">{emoji}</Emoji>

          <VStack align="center" gap="xxs">
            <AppText variant="miniMicro" color="text" center {...FIT_LABEL}>
              {title}
            </AppText>

            {detail ? (
              <AppText
                variant="miniMicro"
                center
                style={[{ color: tint }, !uppercaseDetail && styles.asWritten]}
                {...FIT_LABEL}
              >
                {detail}
              </AppText>
            ) : null}
          </VStack>
        </VStack>
      </Card>
    </Pressable>
  ),
);

QuickActionCard.displayName = 'QuickActionCard';

const styles = StyleSheet.create({
  /**
   * The side padding is far tighter than a card's default: at a quarter of the
   * screen, every point spent on padding comes straight out of the label.
   */
  card: { paddingVertical: spacing.md, paddingHorizontal: spacing.xs },
  asWritten: { textTransform: 'none' },
});
