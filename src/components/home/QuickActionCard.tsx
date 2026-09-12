import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { spacing } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Icon } from '../media/Icon';
import { VStack } from '../layout/Stack';
import { Pressable } from '../form/Pressable';

/**
 * Fixed width so every card in the row is the same size regardless of how long
 * its title is, and so the row scrolls in even steps.
 */
export const QUICK_ACTION_WIDTH = moderateScale(132);

interface Props {
  icon: LucideIcon;
  tint: string;
  /** The first line, in the card's own colour. */
  title: string;
  /** The second line, in the tint — "achievements", "7 days". */
  detail?: string;
  onPress: () => void;
}

/**
 * One shortcut tile: an icon over two lines of label.
 *
 * The tint is spent on the second line and the icon only. Colouring the whole
 * title would put four differently-coloured blocks of text in one row and
 * leave nothing for the eye to scan down; keeping the first line neutral means
 * the four titles read as one list and the colour reads as a category.
 *
 * The icon carries no disc behind it. At this size the badge's tinted circle
 * became the largest shape on the tile and four of them across a scrolling row
 * read as a row of buttons rather than a row of labels.
 */
export const QuickActionCard = memo(
  ({ icon, tint, title, detail, onPress }: Props) => (
    <Pressable
      onPress={onPress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title} ${detail}` : title}
    >
      <Card elevation="low" radius="xl" style={styles.card}>
        <VStack align="center" gap="md">
          <Icon as={icon} size="xl" tint={tint} />

          <VStack align="center" gap="xxs">
            <AppText variant="micro" color="text" center numberOfLines={2}>
              {title}
            </AppText>

            {detail ? (
              <AppText
                variant="micro"
                center
                numberOfLines={1}
                style={{ color: tint }}
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

/**
 * The one thing the primitives cannot express: a tile that is as tall as it is
 * wide, which is what stops the four of them reading as a row of list rows.
 */
const styles = StyleSheet.create({
  card: { width: QUICK_ACTION_WIDTH, paddingVertical: spacing.lg },
});
