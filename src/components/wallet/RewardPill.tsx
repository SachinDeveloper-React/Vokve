import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Coins } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { Box } from '../layout/Box';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

interface Props {
  label?: string;
  /**
   * `card` is the outlined pill for a tinted card in the theme's own colours.
   * `overlay` is for the dark hero panels, where a white card-coloured pill
   * would be the brightest thing on the surface.
   */
  surface?: 'card' | 'overlay';
}

/**
 * The reassurance line under the balance: these coins buy real things.
 *
 * Outlined rather than filled. It sits inside a card that is already tinted,
 * and a second wash of the same accent there would read as a button the user
 * is meant to press.
 */
export const RewardPill = memo(
  ({ label = 'Real rewards. Real effort.', surface = 'card' }: Props) => {
    const { colors } = useTheme();
    const onOverlay = surface === 'overlay';

    return (
      <Box
        bg={onOverlay ? undefined : 'card'}
        bordered={!onOverlay}
        radius="sm"
        px="sm"
        py="xs"
        style={[
          styles.pill,
          onOverlay && { backgroundColor: colors.overlayMedium },
        ]}
      >
        <HStack align="center" gap="xs">
          <Icon as={Coins} size="xs" tint={colors.brandAccent} />
          <AppText variant="micro" style={{ color: colors.brandAccent }}>
            {label}
          </AppText>
        </HStack>
      </Box>
    );
  },
);

RewardPill.displayName = 'RewardPill';

/** Hugs its text instead of stretching to the column's width. */
const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start' },
});
