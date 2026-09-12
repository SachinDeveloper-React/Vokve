import React, { memo } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet } from 'react-native';
import { fontWeight } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

interface Props {
  icon: LucideIcon;
  /** Colours the glyph only. Pass a theme colour. */
  tint: string;
  /** The promise — "Fast Delivery". */
  title: string;
  /** What it means — "Quick and reliable shipping". */
  caption: string;
}

/**
 * One promise in the strip along the foot of the shop.
 *
 * A bare glyph, not a badge: four discs in a strip meant to be read once and
 * trusted would be the largest things on it, and the strip's job is to be
 * quiet. The colour stays on the glyph, where it separates the four promises
 * without ranking them.
 */
export const ShopAssuranceItem = memo(({ icon, tint, title, caption }: Props) => (
  <HStack align="start" gap="sm">
    <Icon as={icon} size="md" tint={tint} />

    <VStack flex={1} gap="xxs">
      <AppText variant="micro" numberOfLines={1} style={styles.title}>
        {title}
      </AppText>
      <AppText variant="micro" color="textTertiary" numberOfLines={2}>
        {caption}
      </AppText>
    </VStack>
  </HStack>
));

ShopAssuranceItem.displayName = 'ShopAssuranceItem';

/**
 * `micro` is the only unshouted step small enough for the strip, and it is a
 * medium weight tuned for values; a promise wants the extra weight so it can
 * be told from the caption beneath it.
 */
const styles = StyleSheet.create({
  title: { fontWeight: fontWeight.semibold },
});
