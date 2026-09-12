import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { typography } from '../../theme';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';

interface Props {
  icon: LucideIcon;
  /** Colours the glyph. Pass a theme colour, not a literal. */
  tint: string;
  /** The shortcut itself — "EARN COINS". */
  title: string;
  /** What it leads to — "More ways to earn". */
  caption: string;
  onPress: () => void;
}

/**
 * One shortcut in the wallet's action row.
 *
 * The badge is `muted` rather than tinted: four coloured discs across one row
 * would read as four buttons of different importance, when they are four
 * equals. The colour stays on the glyph, where it identifies the destination
 * without ranking it.
 */
export const WalletActionItem = memo(
  ({ icon, tint, title, caption, onPress }: Props) => (
    <Pressable
      onPress={onPress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${caption}`}
      style={styles.item}
    >
      <VStack align="center" gap="sm" px="xxs">
        <IconBadge icon={icon} tint={tint} size={36} variant="muted" />

        <VStack align="center" gap="xxs">
          <AppText variant="label" center numberOfLines={2} style={styles.title}>
            {title}
          </AppText>
          <AppText variant="micro" color="textSecondary" center numberOfLines={2}>
            {caption}
          </AppText>
        </VStack>
      </VStack>
    </Pressable>
  ),
);

WalletActionItem.displayName = 'WalletActionItem';

/**
 * The one thing the primitives cannot express here: `Pressable` is not a `Box`,
 * so its equal share of the row has to be given as a style.
 */
const styles = StyleSheet.create({
  item: { flex: 1 },
  /**
   * Two lines' worth of height, whether the title needs it or not. "COIN
   * HISTORY" is the only one of the four that wraps, and without a floor under
   * every title its caption would sit a line lower than the rest of the row.
   */
  title: { minHeight: typography.label.lineHeight * 2 },
});
