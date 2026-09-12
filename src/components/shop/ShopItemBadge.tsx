import React, { memo } from 'react';
import type { ThemeColors } from '../../constants/colors';
import { useTheme } from '../../theme';
import type { ShopBadge } from '../../types/models';
import { Tag } from '../ui/Tag';

type BadgeTint = Extract<
  keyof ThemeColors,
  'avatarPurple' | 'avatarGreen' | 'primary' | 'avatarPink'
>;

/**
 * Label and colour per flag, declared once so a "Limited" tag is the same
 * pink on the card, in the detail sheet, and anywhere else it turns up.
 */
const BADGES: Record<ShopBadge, { label: string; tint: BadgeTint }> = {
  bestseller: { label: 'Bestseller', tint: 'avatarPurple' },
  popular: { label: 'Popular', tint: 'avatarGreen' },
  new_arrival: { label: 'New Arrival', tint: 'primary' },
  limited: { label: 'Limited', tint: 'avatarPink' },
};

interface Props {
  badge: ShopBadge;
}

/** The flag in the corner of a reward's art — "Bestseller", "Limited". */
export const ShopItemBadge = memo(({ badge }: Props) => {
  const { colors } = useTheme();
  const { label, tint } = BADGES[badge];

  return <Tag label={label} tint={colors[tint]} />;
});

ShopItemBadge.displayName = 'ShopItemBadge';
