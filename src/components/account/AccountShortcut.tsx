import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { typography } from '../../theme';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';

/** The disc's diameter, at the 375pt baseline. Five of these share one row. */
const BADGE_SIZE = 40;

interface Props {
  icon: LucideIcon;
  /** Colours the glyph, and the wash behind it. Pass a theme colour. */
  tint: string;
  label: string;
  onPress: () => void;
}

/**
 * One shortcut in the account screen's settings row.
 *
 * The discs are tinted here where the wallet's equivalent row leaves them
 * `muted`. That row's four items are destinations of equal weight, listed
 * under a heading that already groups them; these five are unrelated corners
 * of the app with nothing above them to say so, and the colour is what lets a
 * user find "Security" again on their second visit without reading all five.
 */
export const AccountShortcut = memo(({ icon, tint, label, onPress }: Props) => (
  <Pressable
    onPress={onPress}
    feedback="scale"
    accessibilityRole="button"
    accessibilityLabel={label}
    style={styles.item}
  >
    <VStack align="center" gap="sm" px="xxs">
      <IconBadge icon={icon} tint={tint} size={BADGE_SIZE} />

      <AppText
        variant="miniMicro"
        center
        numberOfLines={2}
        style={styles.label}
      >
        {label}
      </AppText>
    </VStack>
  </Pressable>
));

AccountShortcut.displayName = 'AccountShortcut';

/**
 * `Pressable` is not a `Box`, so its equal share of the row has to be given as
 * a style. The label is floored at two lines' height whether it needs them or
 * not: "Notification Settings" is the only one of the five that wraps, and
 * without a floor under the rest its disc would sit a line higher than theirs.
 */
const styles = StyleSheet.create({
  item: { flex: 1 },
  label: { minHeight: typography.micro.lineHeight * 2 },
});
