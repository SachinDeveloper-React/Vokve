import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { radius, spacing, typography, useTheme } from '../../theme';
import { AppText } from './AppText';

interface Props {
  label: string;
  /** The fill. The label is always white on it. Pass a theme colour. */
  tint: string;
  accessibilityLabel?: string;
}

/**
 * A small solid pill — a level beside a name, a "Bestseller" flag on a card.
 *
 * The solid counterpart to `Chip`. A Chip derives its background as a wash of
 * its tint, which is what keeps a row of them quiet next to body text; a Tag
 * spends the tint on the fill and is meant to be the loudest small thing in
 * its corner, which is why it sits on dark panels and product art where a
 * wash would vanish.
 */
export const Tag = memo(({ label, tint, accessibilityLabel }: Props) => {
  const { colors } = useTheme();

  return (
    <AppText
      style={[
        styles.pill,
        { backgroundColor: tint, color: colors.primaryForeground },
      ]}
      maxFontSizeMultiplier={1.3}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {label}
    </AppText>
  );
});

Tag.displayName = 'Tag';

/**
 * Styled as a Text rather than a Text inside a View so the pill's padding
 * hugs the label's own line box — a wrapping View would let the pill grow
 * taller than the text it sits beside once the OS font scale is raised.
 */
const styles = StyleSheet.create({
  pill: {
    ...typography.miniMicro,
    fontWeight: '700',
    overflow: 'hidden',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
});
