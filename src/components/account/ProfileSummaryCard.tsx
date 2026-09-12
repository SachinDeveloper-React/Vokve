import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { CalendarDays, ChevronRight, Medal } from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Avatar } from '../media/Avatar';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';
import { LevelBadge } from './LevelBadge';
import { ProfileStatStrip } from './ProfileStatStrip';

interface Props {
  /** Null while the profile is loading. */
  name?: string | null;
  avatarUri?: string | null;
  level: number;
  /** The rank that goes with the level — "Athlo Warrior". */
  tierTitle: string;
  /** Already formatted for display — "May 2025". */
  memberSince: string;
  coins: number;
  streakDays: number;
  achievements: number;
  totalSteps: number;
  onPress: () => void;
}

/**
 * The account screen's hero: who the user is and what they have to show for it.
 *
 * The whole panel is one press target rather than a card with a button in the
 * corner. Everything on it — name, level, rank, join date, every figure in the
 * strip — leads to the same place, the full profile, so splitting it into a
 * readable part and a tappable part would only invite a user to hunt for which
 * bit was the link.
 */
export const ProfileSummaryCard = memo(
  ({
    name,
    avatarUri,
    level,
    tierTitle,
    memberSince,
    coins,
    streakDays,
    achievements,
    totalSteps,
    onPress,
  }: Props) => {
    const { colors } = useTheme();

    const foreground = colors.tierForeground;
    const secondary = withAlpha(foreground, 0.72);

    return (
      <Pressable
        onPress={onPress}
        feedback="scale"
        accessibilityRole="button"
        accessibilityLabel={`${
          name ?? 'Your account'
        }, level ${level}, ${tierTitle}. Open profile`}
      >
        <LinearGradient
          colors={colors.gradient.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.panel}
        >
          <VStack gap="base" style={{ padding: spacing.lg }}>
            <HStack align="center" gap="base">
              <Avatar
                name={name ?? 'vokve'}
                uri={avatarUri}
                size="lg"
                ring={darkColors.gold}
              />

              <VStack flex={1} gap="xs">
                <HStack align="center" gap="sm">
                  <AppText
                    variant="h2"
                    numberOfLines={1}
                    style={[styles.name, { color: foreground }]}
                  >
                    {name ?? 'Your account'}
                  </AppText>
                  <LevelBadge level={level} />
                </HStack>

                <HStack align="center" gap="xs">
                  <Icon as={Medal} size="xs" tint={secondary} />
                  <AppText
                    variant="caption"
                    numberOfLines={1}
                    style={{ color: secondary }}
                  >
                    {tierTitle}
                  </AppText>
                </HStack>

                <HStack align="center" gap="xs">
                  <Icon as={CalendarDays} size="xs" tint={secondary} />
                  <AppText
                    variant="caption"
                    numberOfLines={1}
                    style={{ color: secondary }}
                  >
                    {`Member since ${memberSince}`}
                  </AppText>
                </HStack>
              </VStack>

              <Icon
                as={ChevronRight}
                size="md"
                tint={withAlpha(foreground, 0.5)}
              />
            </HStack>

            <Divider tint={colors.overlayMedium} />

            <ProfileStatStrip
              coins={coins}
              streakDays={streakDays}
              achievements={achievements}
              totalSteps={totalSteps}
            />
          </VStack>
        </LinearGradient>
      </Pressable>
    );
  },
);

ProfileSummaryCard.displayName = 'ProfileSummaryCard';

/**
 * The two things the primitives cannot express: `Box` has no gradient, so the
 * panel's own padding and rounding have to be given to `LinearGradient`
 * directly; and the name has to be allowed to shrink so a long one truncates
 * instead of pushing the level badge off the row.
 */
const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.xl,
    //  margin: spacing.lg,
    overflow: 'hidden',
  },
  name: { flexShrink: 1 },
});
