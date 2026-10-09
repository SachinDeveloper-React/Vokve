import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import type { Challenge } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';
import { ActiveChallengeRow } from './ActiveChallengeRow';

/**
 * How many running challenges the board shows inline. "View All" is what the
 * rest are behind: a card that grew with the list would push the achievements
 * under it off the screen, and three is what fits above the fold.
 */
const MAX_ROWS = 3;

interface Props {
  challenges: Challenge[];
  /**
   * How many rows to draw. The full list screen passes the lot; the board
   * takes the default, which is what "View All" exists to get past.
   */
  max?: number;
  /** Left off, the link is too — the full list has nowhere further to go. */
  onPressViewAll?: () => void;
  /** Opens one challenge in full. Left off, the rows are read-only. */
  onPressChallenge?: (id: string) => void;
}

/**
 * What the user is in the middle of.
 *
 * The one dark panel on the screen, and deliberately the first thing under the
 * filter: everything below it — achievements won, challenges still to open —
 * is context for the three bars here, which are the only things the user can
 * still move today.
 */
export const ActiveChallengesCard = memo(
  ({ challenges, max = MAX_ROWS, onPressViewAll, onPressChallenge }: Props) => {
    const { colors } = useTheme();
    const foreground = darkColors.tierForeground;
    const visible = challenges.slice(0, max);

    return (
      <View
        style={[styles.panel, { backgroundColor: colors.tierBackground }]}
      >
        <VStack gap="base">
          <HStack align="center" justify="between" gap="sm">
            <AppText
              variant="label"
              style={{ color: withAlpha(foreground, 0.72) }}
            >
              Active Challenges
            </AppText>

            {onPressViewAll ? (
              <Pressable
                onPress={onPressViewAll}
                feedback="opacity"
                accessibilityRole="link"
                accessibilityLabel="View all active challenges"
              >
                <HStack align="center" gap="xxs">
                  <AppText
                    variant="micro"
                    style={{ color: withAlpha(foreground, 0.72) }}
                  >
                    View All
                  </AppText>
                  <Icon
                    as={ChevronRight}
                    size="xs"
                    tint={withAlpha(foreground, 0.72)}
                  />
                </HStack>
              </Pressable>
            ) : null}
          </HStack>

          {visible.length === 0 ? (
            // A plain line rather than `EmptyState`: that component draws its
            // text in the theme's own colours, which on this panel would be
            // near-black on navy.
            <AppText
              variant="micro"
              style={{ color: withAlpha(foreground, 0.72) }}
            >
              Nothing running for this period — see what is coming up below.
            </AppText>
          ) : (
            visible.map(challenge => (
              <ActiveChallengeRow
                key={challenge.id}
                challenge={challenge}
                onPress={onPressChallenge}
              />
            ))
          )}
        </VStack>
      </View>
    );
  },
);

ActiveChallengesCard.displayName = 'ActiveChallengesCard';

const styles = StyleSheet.create({
  panel: { borderRadius: radius.xl, padding: spacing.base },
});
