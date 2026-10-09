import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { PartyPopper } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import type { AchievementDetail } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';

interface Props {
  cheer: AchievementDetail['cheer'];
  unlocked: boolean;
}

/**
 * The line of encouragement under the facts.
 *
 * Green once the badge is won and the brand accent while it is not: the
 * colour is the second way the screen says which state this is, after the
 * status chip at the top, and a congratulation in the same green as a
 * "keep going" would make the two indistinguishable at a glance.
 */
export const AchievementCheerCard = memo(({ cheer, unlocked }: Props) => {
  const { colors, isDark } = useTheme();
  const tint = unlocked ? colors.success : colors.brandAccent;

  return (
    <Box
      p="base"
      style={[
        styles.panel,
        {
          backgroundColor: withAlpha(tint, isDark ? 0.16 : 0.1),
          borderColor: withAlpha(tint, 0.4),
        },
      ]}
    >
      <HStack align="center" gap="md">
        <IconBadge icon={PartyPopper} tint={tint} size={36} variant="outline" />

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" style={{ color: tint }}>
            {cheer.title}
          </AppText>
          <AppText variant="micro" color="textSecondary">
            {cheer.message}
          </AppText>
        </VStack>
      </HStack>
    </Box>
  );
});

AchievementCheerCard.displayName = 'AchievementCheerCard';

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
