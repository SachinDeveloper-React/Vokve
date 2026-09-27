import React, { memo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import {
  Coins,
  Dumbbell,
  Flame,
  Footprints,
  Medal,
  Package,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { ProfileBadge, ProfileBadgeIcon } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { formatCompactNumber } from '../../utils/format';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';

/** The glyph each badge kind is drawn with — the server names the kind, not the icon. */
const BADGE_ICON: Record<ProfileBadgeIcon, LucideIcon> = {
  flame: Flame,
  footprints: Footprints,
  dumbbell: Dumbbell,
  coins: Coins,
  package: Package,
  users: Users,
  medal: Medal,
};

interface Props {
  badges: readonly ProfileBadge[];
}

/**
 * What the member has earned, and what is nearly earned.
 *
 * Unlocked badges come first and locked ones keep their place in the row
 * with a progress bar under them: a badge at 6/7 days is the single best
 * reason to come back tomorrow, and hiding it until it is won would throw
 * that away. A locked one is drawn in grey rather than removed, so the
 * shelf's length never changes under the user.
 */
export const BadgeShelf = memo(({ badges }: Props) => {
  const { colors } = useTheme();
  const unlocked = badges.filter(b => b.unlockedAt !== null).length;
  const ordered = [...badges].sort((a, b) => {
    const byState =
      Number(b.unlockedAt !== null) - Number(a.unlockedAt !== null);
    return byState !== 0 ? byState : b.progress - a.progress;
  });

  return (
    <Card radius="xl" padding="base">
      <VStack gap="md">
        <HStack align="center" justify="between">
          <AppText variant="bodyStrong">Achievements</AppText>
          <AppText variant="micro" color="textSecondary">
            {`${unlocked} of ${badges.length} earned`}
          </AppText>
        </HStack>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {ordered.map(badge => {
            const earned = badge.unlockedAt !== null;
            const tint = earned ? colors.gold : colors.textQuaternary;
            return (
              <VStack
                key={badge.id}
                gap="xs"
                align="center"
                style={styles.badge}
                accessibilityRole="image"
                accessibilityLabel={
                  earned
                    ? `${badge.label}, earned — ${badge.description}`
                    : `${badge.label}, locked — ${formatCompactNumber(
                        badge.value,
                      )} of ${formatCompactNumber(badge.goal)}`
                }
              >
                <Box
                  radius="pill"
                  style={[
                    styles.disc,
                    {
                      backgroundColor: withAlpha(tint, earned ? 0.16 : 0.08),
                      borderColor: earned ? tint : colors.border,
                    },
                  ]}
                >
                  <Icon as={BADGE_ICON[badge.icon]} size="lg" tint={tint} />
                </Box>
                <AppText
                  variant="micro"
                  center
                  numberOfLines={2}
                  color={earned ? 'text' : 'textTertiary'}
                  style={styles.label}
                >
                  {badge.label}
                </AppText>
                {earned ? null : (
                  <VStack gap="xxs" style={styles.meter}>
                    <ProgressBar progress={badge.progress} height={3} />
                    <AppText variant="miniMicro" color="textTertiary" center>
                      {`${formatCompactNumber(
                        badge.value,
                      )}/${formatCompactNumber(badge.goal)}`}
                    </AppText>
                  </VStack>
                )}
              </VStack>
            );
          })}
        </ScrollView>
      </VStack>
    </Card>
  );
});

BadgeShelf.displayName = 'BadgeShelf';

const BADGE_WIDTH = moderateScale(76);

const styles = StyleSheet.create({
  row: { gap: spacing.md, paddingRight: spacing.xs },
  badge: { width: BADGE_WIDTH },
  disc: {
    width: moderateScale(52),
    height: moderateScale(52),
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { minHeight: 26 },
  meter: { alignSelf: 'stretch' },
});
