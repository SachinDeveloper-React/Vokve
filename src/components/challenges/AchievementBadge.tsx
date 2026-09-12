import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { Achievement } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { METRIC_STYLE } from './metrics';

/** The ring's outer diameter at the 375pt baseline; five share a row. */
const RING = moderateScale(48);

interface Props {
  achievement: Achievement;
}

/**
 * One achievement: a ring with what it took inside, and what it was for below.
 *
 * A locked badge drops the colour entirely and carries a padlock rather than
 * its figure. Greying the ring alone would leave five discs that differ only
 * in saturation, and the whole point of the shelf is that the earned ones are
 * obvious at a glance — the locked ones are what is left to aim at.
 *
 * The status word under the label repeats what the colour says, for the same
 * reason: "Achieved" and "Locked" survive a reader who cannot tell a green
 * ring from a grey one.
 */
export const AchievementBadge = memo(({ achievement }: Props) => {
  const { colors, isDark } = useTheme();
  const achieved = achievement.achievedAt !== null;
  const tint = colors[METRIC_STYLE[achievement.metric].tint];

  return (
    <VStack
      align="center"
      gap="xs"
      flex={1}
      accessible
      accessibilityLabel={`${achievement.label}, ${
        achieved ? 'achieved' : 'locked'
      }`}
    >
      <View
        style={[
          styles.ring,
          achieved
            ? {
                borderColor: tint,
                backgroundColor: withAlpha(tint, isDark ? 0.22 : 0.1),
              }
            : { borderColor: colors.border, backgroundColor: colors.muted },
        ]}
      >
        {achieved ? (
          <AppText variant="bodyStrong" numberOfLines={1} style={{ color: tint }}>
            {achievement.value}
          </AppText>
        ) : (
          <Icon as={Lock} size="sm" color="textTertiary" />
        )}
      </View>

      <VStack align="center" gap="none">
        <AppText variant="miniMicro" center numberOfLines={2}>
          {achievement.label}
        </AppText>
        <AppText
          variant="miniMicro"
          center
          style={achieved ? { color: tint } : undefined}
          color={achieved ? undefined : 'textTertiary'}
        >
          {achieved ? 'Achieved' : 'Locked'}
        </AppText>
      </VStack>
    </VStack>
  );
});

AchievementBadge.displayName = 'AchievementBadge';

const styles = StyleSheet.create({
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
