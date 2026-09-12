import React, { memo } from 'react';
import { ChevronRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';

/** Tile size at the 375pt baseline. Small enough to keep the row 56pt tall. */
const TILE_SIZE = 38;

interface Props {
  icon: LucideIcon;
  /** Colours the glyph, and the wash behind it. Pass a theme colour. */
  tint: string;
  title: string;
  /** What the row leads to, in a sentence — never a repeat of the title. */
  subtitle: string;
  /** An optional read-only value shown before the chevron — "v1.0.0". */
  value?: string;
  onPress: () => void;
}

/**
 * One row in the account menu.
 *
 * The tile is a squircle where every other badge in the app is a circle. Down
 * a column of seven, circles leave a ragged left margin against the square
 * corners of the card around them; a shared corner radius lines the tiles up
 * with the card and turns the column into a single block.
 */
export const AccountMenuRow = memo(
  ({ icon, tint, title, subtitle, value, onPress }: Props) => {
    const { colors } = useTheme();

    return (
      <Pressable
        onPress={onPress}
        feedback="highlight"
        accessibilityRole="button"
        accessibilityLabel={value ? `${title}, ${value}. ${subtitle}` : `${title}. ${subtitle}`}
      >
        <HStack align="center" gap="base" py="md">
          <IconBadge
            icon={icon}
            tint={tint}
            size={TILE_SIZE}
            shape="rounded"
          />

          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong" numberOfLines={1}>
              {title}
            </AppText>
            {/*
              Two lines rather than one: the longest of these subtitles is a
              character or two past what a 375pt row holds, and truncating a
              sentence that explains the row is worse than letting it wrap.
            */}
            <AppText variant="caption" color="textSecondary" numberOfLines={2}>
              {subtitle}
            </AppText>
          </VStack>

          {value ? (
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {value}
            </AppText>
          ) : null}

          <Icon as={ChevronRight} size="sm" tint={colors.textTertiary} />
        </HStack>
      </Pressable>
    );
  },
);

AccountMenuRow.displayName = 'AccountMenuRow';
