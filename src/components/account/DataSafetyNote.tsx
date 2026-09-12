import React, { memo } from 'react';
import { Check, ShieldCheck } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';

/** Tile size at the 375pt baseline, matched to the menu rows above it. */
const TILE_SIZE = 38;

/**
 * The privacy reassurance that closes the account screen.
 *
 * It sits at the foot rather than the top on purpose: it is an answer to a
 * question the screen itself raises, and a user only starts wondering where
 * their data goes once they have scrolled past health data and connected
 * accounts. Green because it is a state, not an action — nothing on it is
 * tappable, and it deliberately offers no link to bury the claim behind.
 */
export const DataSafetyNote = memo(() => {
  const { colors, isDark } = useTheme();

  return (
    <Card
      radius="xl"
      padding="base"
      style={{
        backgroundColor: withAlpha(colors.success, isDark ? 0.12 : 0.08),
        borderColor: withAlpha(colors.success, isDark ? 0.24 : 0.16),
      }}
    >
      <HStack align="center" gap="base">
        <IconBadge
          icon={ShieldCheck}
          tint={colors.success}
          size={TILE_SIZE}
          shape="rounded"
        />

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" color="success" numberOfLines={1}>
            Your Data is Safe with Us
          </AppText>
          <AppText variant="caption" color="textSecondary">
            We never share your personal data with anyone.
          </AppText>
        </VStack>

        <Icon as={Check} size="lg" color="success" strokeWidth={3} />
      </HStack>
    </Card>
  );
});

DataSafetyNote.displayName = 'DataSafetyNote';
