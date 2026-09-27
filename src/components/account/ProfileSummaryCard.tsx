import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {
  CalendarDays,
  ChevronRight,
  Medal,
  TrendingUp,
} from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import type { ProfileSummary } from '../../types/models';
import { withAlpha } from '../../utils/color';
import {
  formatCoins,
  formatCompactNumber,
  formatGrouped,
  formatMonthYear,
} from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Avatar } from '../media/Avatar';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { ProgressBar } from '../ui/ProgressBar';
import { Pressable } from '../form/Pressable';
import { LevelBadge } from './LevelBadge';
import { ProfileStatStrip } from './ProfileStatStrip';

interface Props {
  /** Null while the profile is loading. */
  name?: string | null;
  avatarUri?: string | null;
  /** The server's summary, or null before the first sync. */
  summary: ProfileSummary | null;
  /** Spendable coins from the wallet, which is fresher than the summary. */
  coins: number;
  onPress: () => void;
}

/**
 * The account screen's hero: who the user is and what they have to show for it.
 *
 * Every figure is the server's (RULES P4): the level from lifetime coins, the
 * bar from where those coins sit inside the level band, the rank from how
 * many members have earned more. Nothing is computed here, so the card can
 * never disagree with the profile screen it leads to.
 *
 * The whole panel is one press target rather than a card with a button in the
 * corner. Everything on it — name, level, rank, join date, every figure in the
 * strip — leads to the same place, so splitting it into a readable part and a
 * tappable part would only invite a user to hunt for which bit was the link.
 *
 * With no summary yet the panel still draws: the name and the avatar are the
 * auth store's and arrive first, and the figures come in a beat later rather
 * than the card appearing from nothing.
 */
export const ProfileSummaryCard = memo(
  ({ name, avatarUri, summary, coins, onPress }: Props) => {
    const { colors } = useTheme();

    const foreground = colors.tierForeground;
    const secondary = withAlpha(foreground, 0.72);
    const level = summary?.level ?? 1;
    const memberSince = summary ? formatMonthYear(summary.memberSince) : '—';

    return (
      <Pressable
        onPress={onPress}
        feedback="scale"
        accessibilityRole="button"
        accessibilityLabel={`${name ?? 'Your account'}, level ${level}${
          summary ? `, ${summary.tierTitle}` : ''
        }. Open profile`}
      >
        <LinearGradient
          colors={colors.gradient.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.panel}
        >
          <VStack gap="base" style={styles.body}>
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
                    {summary?.tierTitle ?? 'Getting started'}
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

            {summary ? (
              <VStack gap="xs">
                <HStack align="center" justify="between" gap="sm">
                  <AppText variant="micro" style={{ color: secondary }}>
                    {`${formatCoins(summary.xpIntoLevel)} / ${formatCoins(
                      summary.xpForNextLevel,
                    )} to level ${summary.level + 1}`}
                  </AppText>
                  {summary.rank !== null ? (
                    <HStack align="center" gap="xxs">
                      <Icon as={TrendingUp} size="xs" tint={secondary} />
                      <AppText variant="micro" style={{ color: secondary }}>
                        {`#${formatGrouped(
                          summary.rank,
                        )} of ${formatCompactNumber(summary.totalMembers)}`}
                      </AppText>
                    </HStack>
                  ) : null}
                </HStack>
                <ProgressBar
                  progress={summary.levelProgress}
                  tint={darkColors.gold}
                />
              </VStack>
            ) : null}

            <Divider tint={colors.overlayMedium} />

            <ProfileStatStrip
              coins={coins}
              streakDays={summary?.stats.currentStreak ?? 0}
              achievements={
                summary?.badges.filter(badge => badge.unlockedAt !== null)
                  .length ?? 0
              }
              totalSteps={summary?.stats.totalSteps ?? 0}
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
  panel: { borderRadius: radius.xl, overflow: 'hidden' },
  body: { padding: spacing.lg },
  name: { flexShrink: 1 },
});
