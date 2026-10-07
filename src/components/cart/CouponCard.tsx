import React, { memo } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { BadgePercent, ChevronRight, Diamond } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { AppliedCoupon, PaymentMode } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { formatCoins, formatMoney } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  /** The coupon on the basket as the quote shows it; null for none. */
  coupon: AppliedCoupon | null;
  mode: PaymentMode;
  currency: string;
  /** What the coupon takes off in coins, in a coins-only shop. */
  coinDiscount: number | null;
  /** A removal is in flight. */
  busy?: boolean;
  onPressApply: () => void;
  onPressRemove: () => void;
}

const makeStyles = ({ spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    card: {
      borderRadius: radius.xl,
      borderWidth: 1,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.base,
    },
    action: { fontWeight: '600' },
  });

/**
 * The basket's coupon box (RULES R16), in three states: an invitation to
 * apply one, the coupon applied with what it saves, or the coupon kept but
 * not applying with the reason — "Add ₹150 more" — and a way to drop it.
 * The saving is the server's figure, in coins in a coins-only shop.
 */
export const CouponCard = memo(
  ({
    coupon,
    mode,
    currency,
    coinDiscount,
    busy = false,
    onPressApply,
    onPressRemove,
  }: Props) => {
    const styles = useThemedStyles(makeStyles);
    const { colors, isDark } = useTheme();
    const tone =
      coupon && !coupon.problem ? colors.success : colors.brandAccent;
    const frame = {
      backgroundColor: withAlpha(tone, isDark ? 0.14 : 0.08),
      borderColor: withAlpha(tone, isDark ? 0.55 : 0.45),
    };

    if (!coupon) {
      return (
        <Pressable
          onPress={onPressApply}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel="Have a coupon? Apply coupon"
        >
          <HStack align="center" gap="md" style={[styles.card, frame]}>
            <Icon as={Diamond} size="md" tint={colors.brandAccent} />
            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong">Have a coupon?</AppText>
              <AppText variant="micro" color="textSecondary">
                Apply coupon to get more rewards!
              </AppText>
            </VStack>
            <HStack align="center" gap="xxs">
              <AppText
                variant="caption"
                style={[styles.action, { color: colors.brandAccent }]}
              >
                Apply Coupon
              </AppText>
              <Icon as={ChevronRight} size="xs" tint={colors.brandAccent} />
            </HStack>
          </HStack>
        </Pressable>
      );
    }

    const saving =
      mode === 'coins' && coinDiscount !== null
        ? `${formatCoins(coinDiscount)} coins`
        : formatMoney(coupon.discount, currency);

    return (
      <HStack align="center" gap="md" style={[styles.card, frame]}>
        <Icon as={BadgePercent} size="md" tint={tone} />
        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong">
            {coupon.problem ? coupon.code : `${coupon.code} applied`}
          </AppText>
          {coupon.problem ? (
            <AppText variant="micro" color="warning">
              {coupon.problem}
            </AppText>
          ) : (
            <AppText variant="micro" color="textSecondary">
              {`You save ${saving} · ${coupon.title}`}
            </AppText>
          )}
        </VStack>
        {busy ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : (
          <Pressable
            onPress={onPressRemove}
            feedback="opacity"
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove coupon ${coupon.code}`}
          >
            <AppText
              variant="caption"
              style={[styles.action, { color: colors.brandAccent }]}
            >
              Remove
            </AppText>
          </Pressable>
        )}
      </HStack>
    );
  },
);

CouponCard.displayName = 'CouponCard';
