import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { Achievement } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { Pressable } from '../form/Pressable';
import { AppText } from '../ui/AppText';
import { METRIC_STYLE, formatBadgeValue } from './metrics';

/** The ring's outer diameter at the 375pt baseline; five share a row. */
const RING = moderateScale(48);

interface Props {
  achievement: Achievement;
  /** Opens the badge in full. Left off, the ring is a readout. */
  onPress?: (id: string) => void;
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
 *
 * When the ring leads somewhere, the press target carries the description
 * itself rather than wrapping an element that already has one: a nested
 * accessible view hides the button from a screen reader, which leaves a badge
 * that reads perfectly and cannot be opened.
 */
export const AchievementBadge = memo(({ achievement, onPress }: Props) => {
  const { colors, isDark } = useTheme();
  const achieved = achievement.achievedAt !== null;
  const tint = colors[METRIC_STYLE[achievement.metric].tint];

  const label = `${achievement.label}, ${achieved ? 'achieved' : 'locked'}`;
  const press = useCallback(
    () => onPress?.(achievement.id),
    [achievement.id, onPress],
  );

  const body = (
    <VStack align="center" gap="xs" flex={1}>
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
            {formatBadgeValue(achievement.value)}
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

  return onPress ? (
    <Pressable
      onPress={press}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens this achievement"
      style={styles.target}
    >
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label} style={styles.target}>
      {body}
    </View>
  );
});

AchievementBadge.displayName = 'AchievementBadge';

const styles = StyleSheet.create({
  // The wrapper takes the column the badge used to take itself, so a row of
  // five still divides evenly whether or not the rings lead anywhere.
  target: { flex: 1 },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
