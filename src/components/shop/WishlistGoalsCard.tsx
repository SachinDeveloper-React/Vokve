import React, { Fragment, memo, useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronRight, CircleCheck, Heart } from 'lucide-react-native';
import { spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { ShopItem } from '../../types/models';
import {
  countReady,
  itemGoalStatus,
  rankCoinGoals,
  type RankedGoal,
} from '../../utils/coinGoal';
import { formatCoins } from '../../utils/format';
import { withAlpha } from '../../utils/color';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppImage } from '../media/AppImage';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { Pressable } from '../form/Pressable';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { CoinGoalMeter } from './CoinGoalMeter';

const ART = moderateScale(52);
const ROW_INDENT = ART + spacing.md;

interface Props {
  /** The saved items, as the wishlist store holds them; null before they arrive. */
  items: ShopItem[] | null;
  balance: number;
  /** How many rows to draw; the rest are a tap away on the wishlist. */
  limit?: number;
  onPressItem: (id: string) => void;
  onPressViewAll: () => void;
}

/**
 * "Saving for": what the member has hearted, and how close their coins are
 * to each (RULES R20). The reason to open the app after a walk — the bar
 * moved — and the shortest way from "I can afford it now" to the product.
 *
 * Ordered by what is actionable: anything they can redeem today first, then
 * whatever is nearest, sold-out items last. The line under the title says
 * the one thing worth knowing at a glance: how many are ready, or how far
 * the nearest one is.
 *
 * Draws nothing when nothing saved takes coins — an empty card on Home
 * asking for a wishlist would be an advert, not a figure.
 */
export const WishlistGoalsCard = memo(
  ({ items, balance, limit = 3, onPressItem, onPressViewAll }: Props) => {
    const { colors } = useTheme();
    const ranked = useMemo(
      () => rankCoinGoals(items ?? [], balance),
      [balance, items],
    );

    if (ranked.length === 0) {
      return null;
    }

    const ready = countReady(ranked);
    const nearest = ranked.find(
      ({ item, goal }) => item.inStock && !goal.reached,
    );
    const summary =
      ready > 0
        ? `${ready} ${
            ready === 1 ? 'reward is' : 'rewards are'
          } ready to redeem`
        : nearest
        ? `${formatCoins(nearest.goal.short)} coins to your next reward`
        : 'Your saved rewards';

    return (
      <Card radius="xl" padding="base">
        <VStack gap="md">
          <HStack align="center" justify="between" gap="sm">
            <HStack align="center" gap="sm" flex={1}>
              <View
                style={[
                  styles.mark,
                  { backgroundColor: withAlpha(colors.destructive, 0.12) },
                ]}
              >
                <Icon
                  as={Heart}
                  size="sm"
                  tint={colors.destructive}
                  fill={colors.destructive}
                />
              </View>
              <VStack flex={1} gap="xxs">
                <AppText variant="bodyStrong" numberOfLines={1}>
                  Saving For
                </AppText>
                <AppText
                  variant="micro"
                  numberOfLines={1}
                  style={{
                    color: ready > 0 ? colors.success : colors.textSecondary,
                  }}
                >
                  {summary}
                </AppText>
              </VStack>
            </HStack>

            <Pressable
              onPress={onPressViewAll}
              feedback="opacity"
              hitSlop={8}
              accessibilityRole="link"
              accessibilityLabel={`View all ${ranked.length} saved rewards`}
            >
              <HStack align="center" gap="xxs">
                <AppText variant="micro" style={{ color: colors.brandAccent }}>
                  View All
                </AppText>
                <Icon as={ChevronRight} size="xs" tint={colors.brandAccent} />
              </HStack>
            </Pressable>
          </HStack>

          <VStack gap="md">
            {ranked.slice(0, limit).map((entry, index) => (
              <Fragment key={entry.item.id}>
                {index > 0 ? <Divider indent={ROW_INDENT} /> : null}
                <GoalRow entry={entry} onPress={onPressItem} />
              </Fragment>
            ))}
          </VStack>
        </VStack>
      </Card>
    );
  },
);

WishlistGoalsCard.displayName = 'WishlistGoalsCard';

const GoalRow = memo(
  ({
    entry: { item, goal },
    onPress,
  }: {
    entry: RankedGoal;
    onPress: (id: string) => void;
  }) => {
    const { colors } = useTheme();
    const status = itemGoalStatus(goal, item.inStock);
    const press = useCallback(() => onPress(item.id), [item.id, onPress]);

    return (
      <Pressable
        onPress={press}
        feedback="opacity"
        accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${formatCoins(
          goal.have,
        )} of ${formatCoins(goal.goal)} coins. ${status.long}.`}
        accessibilityHint="Opens the product"
      >
        <HStack align="center" gap="md">
          <View
            style={[
              styles.art,
              { backgroundColor: colors.muted },
              !item.inStock && styles.soldOut,
            ]}
          >
            <AppImage
              uri={item.images[0]}
              width={ART}
              height={ART}
              radius="lg"
              resizeMode="cover"
              accessibilityLabel={item.title}
              fallback={
                <Emoji size={moderateScale(26)} label={item.title}>
                  {item.emoji}
                </Emoji>
              }
            />
          </View>

          <VStack flex={1} gap="xs">
            <HStack align="center" justify="between" gap="sm">
              <AppText variant="caption" numberOfLines={1} style={styles.title}>
                {item.title}
              </AppText>
              {status.tone === 'success' ? (
                <Icon as={CircleCheck} size="sm" tint={colors.success} />
              ) : (
                <AppText variant="micro" color="textTertiary">
                  {`${Math.floor(goal.progress * 100)}%`}
                </AppText>
              )}
            </HStack>
            <CoinGoalMeter goal={goal} status={status} variant="compact" />
          </VStack>
        </HStack>
      </Pressable>
    );
  },
);

GoalRow.displayName = 'GoalRow';

const styles = StyleSheet.create({
  mark: {
    width: moderateScale(34),
    height: moderateScale(34),
    borderRadius: moderateScale(17),
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: {
    width: ART,
    height: ART,
    borderRadius: moderateScale(14),
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  soldOut: { opacity: 0.5 },
  title: { flex: 1, fontWeight: '600' },
});
