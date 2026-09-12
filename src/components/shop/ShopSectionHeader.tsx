import React, { memo } from 'react';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  title: string;
  /** Adds a "View All" link on the right. Left off, the row is just a title. */
  onPressViewAll?: () => void;
}

/**
 * A section title with an optional "View All" beside it.
 *
 * The link is a text-and-chevron rather than a button: it sits on the same
 * baseline as a heading, and a pill there would outweigh the heading it is
 * supposed to be subordinate to.
 */
export const ShopSectionHeader = memo(({ title, onPressViewAll }: Props) => {
  const { colors } = useTheme();

  return (
    <HStack align="center" justify="between">
      <AppText variant="h3">{title}</AppText>

      {onPressViewAll ? (
        <Pressable
          onPress={onPressViewAll}
          feedback="opacity"
          accessibilityRole="link"
          accessibilityLabel={`View all ${title}`}
        >
          <HStack align="center" gap="xxs">
            <AppText variant="micro" style={{ color: colors.brandAccent }}>
              View All
            </AppText>
            <Icon as={ChevronRight} size="xs" tint={colors.brandAccent} />
          </HStack>
        </Pressable>
      ) : null}
    </HStack>
  );
});

ShopSectionHeader.displayName = 'ShopSectionHeader';
