import React, { memo, useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ChevronRight, Lock, Star } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { Achievement } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { METRIC_STYLE, formatBadgeValue } from './metrics';

const RING = moderateScale(44);
const TILE = moderateScale(92);

interface TileProps {
  achievement: Achievement;
  current: boolean;
  onPress: (id: string) => void;
}

const RelatedTile = memo(({ achievement, current, onPress }: TileProps) => {
  const { colors, isDark } = useTheme();
  const unlocked = achievement.achievedAt !== null;
  const tint = colors[METRIC_STYLE[achievement.metric].tint];
  const press = useCallback(
    () => onPress(achievement.id),
    [achievement.id, onPress],
  );

  return (
    <Pressable
      onPress={press}
      feedback="scale"
      accessibilityRole="button"
      accessibilityState={{ selected: current }}
      accessibilityLabel={`${achievement.label}, ${
        unlocked ? 'unlocked' : 'locked'
      }${current ? ', the one you are looking at' : ''}`}
    >
      <VStack
        align="center"
        gap="xs"
        p="md"
        style={[
          styles.tile,
          { borderColor: current ? colors.brandAccent : colors.border },
        ]}
      >
        <View
          style={[
            styles.ring,
            unlocked
              ? {
                  borderColor: tint,
                  backgroundColor: withAlpha(tint, isDark ? 0.22 : 0.1),
                }
              : { borderColor: colors.border, backgroundColor: colors.muted },
          ]}
        >
          <AppText
            variant="micro"
            numberOfLines={1}
            style={unlocked ? { color: tint } : undefined}
            color={unlocked ? undefined : 'textTertiary'}
          >
            {formatBadgeValue(achievement.value)}
          </AppText>
        </View>

        <AppText variant="miniMicro" center numberOfLines={2}>
          {achievement.label}
        </AppText>

        <HStack align="center" gap="xxs">
          <Icon
            as={unlocked ? Star : Lock}
            size="xs"
            tint={unlocked ? colors.success : colors.textTertiary}
          />
          <AppText
            variant="miniMicro"
            style={unlocked ? { color: colors.success } : undefined}
            color={unlocked ? undefined : 'textTertiary'}
          >
            {unlocked ? 'Unlocked' : 'Locked'}
          </AppText>
        </HStack>
      </VStack>
    </Pressable>
  );
});

RelatedTile.displayName = 'RelatedTile';

interface Props {
  /** The badges of the same metric, smallest first. */
  related: Achievement[];
  /** The one this screen is about, outlined among the rest. */
  currentId: string;
  onPressAchievement: (id: string) => void;
  onPressViewAll: () => void;
}

/**
 * The rest of the ladder this badge is a rung of.
 *
 * Same metric, smallest first, with the one being read outlined rather than
 * removed: the point of the row is to show where this badge sits between the
 * one before it and the one after, and a list that left it out would make the
 * reader count the gap themselves.
 *
 * It scrolls rather than fitting four across. A steps ladder runs to five
 * rungs and a monthly badge's label is two words, which at a quarter of the
 * width would break in half.
 */
export const RelatedAchievementsCard = memo(
  ({ related, currentId, onPressAchievement, onPressViewAll }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack align="center" justify="between" gap="sm">
            <HStack align="center" gap="sm">
              <Icon as={Star} size="sm" color="textSecondary" />
              <AppText variant="h3">Related Achievements</AppText>
            </HStack>

            <Pressable
              onPress={onPressViewAll}
              feedback="opacity"
              accessibilityRole="link"
              accessibilityLabel="View all achievements"
            >
              <HStack align="center" gap="xxs">
                <AppText variant="micro" style={{ color: colors.brandAccent }}>
                  View All
                </AppText>
                <Icon as={ChevronRight} size="xs" tint={colors.brandAccent} />
              </HStack>
            </Pressable>
          </HStack>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {related.map(achievement => (
              <RelatedTile
                key={achievement.id}
                achievement={achievement}
                current={achievement.id === currentId}
                onPress={onPressAchievement}
              />
            ))}
          </ScrollView>
        </VStack>
      </Card>
    );
  },
);

RelatedAchievementsCard.displayName = 'RelatedAchievementsCard';

const styles = StyleSheet.create({
  row: { gap: spacing.sm },
  tile: { width: TILE, borderRadius: radius.lg, borderWidth: 1 },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
