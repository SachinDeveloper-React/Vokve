import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import { CartLineCard } from '../../components/cart/CartLineCard';
import { CartPromiseStrip } from '../../components/cart/CartPromiseStrip';
import { CouponCard } from '../../components/cart/CouponCard';
import { CouponSheet } from '../../components/cart/CouponSheet';
import { OrderSummaryCard } from '../../components/cart/OrderSummaryCard';
import { SecureRedemptionBanner } from '../../components/cart/SecureRedemptionBanner';
import { useToast } from '../../components/feedback/Toast';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { PayAmount } from '../../components/shop/PayAmount';
import { ShopPageHeader } from '../../components/shop/ShopPageHeader';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { toApiError } from '../../services/api/errors';
import { useAuthStatus } from '../../stores/authStore';
import { cartLineKey, useCart, useCartStore } from '../../stores/cartStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { usePaymentMode, useShopConfig } from '../../stores/shopStore';
import {
  spacing,
  useTheme,
  useThemedStyles,
  type ThemeShape,
} from '../../theme';
import type { CartLine } from '../../types/models';
import { formatCoins } from '../../utils/format';

const makeStyles = ({ spacing: space, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: space.xl, gap: space.base },
    empty: { paddingVertical: space.xl },
    grow: { flex: 1 },
    /** Bleeds through the screen's gutter so the rule runs edge to edge. */
    bar: {
      marginHorizontal: -space.base,
      paddingHorizontal: space.base,
      paddingTop: space.md,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      gap: space.sm,
    },
  });

/**
 * The basket, laid out for redeeming: a word that the order is safe, every
 * line as a card with its stepper and bin, the coupon box, the order's sums
 * and what the member pays, the three promises, and the way on.
 *
 * Every figure is the server's (RULES R11–R14, R16): the basket comes back
 * from each change with its quote, so what this page says the member pays
 * is what the checkout opens with — in coins, in rupees, or both, as the
 * shop's payment mode has it. The way on is shut, with the reason above it,
 * while a line is sold out or the wallet is short of the coins the order
 * must take: the till would refuse the order, and this is where to fix it.
 */
export const CartScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const toast = useToast();
  const balance = useCoinBalance();
  const config = useShopConfig();
  const mode = usePaymentMode();
  const isSignedIn = useAuthStatus() === 'authenticated';

  const cart = useCart();
  const isSyncing = useCartStore(s => s.isSyncing);
  const syncError = useCartStore(s => s.syncError);
  const busyKeys = useCartStore(s => s.busy);
  const hydrate = useCartStore(s => s.hydrateFromServer);
  const setQuantity = useCartStore(s => s.setQuantity);
  const applyCoupon = useCartStore(s => s.applyCoupon);
  const removeCoupon = useCartStore(s => s.removeCoupon);

  const [couponSheetOpen, setCouponSheetOpen] = useState(false);
  const [removingCoupon, setRemovingCoupon] = useState(false);

  useEffect(() => {
    if (isSignedIn) {
      hydrate();
    }
  }, [hydrate, isSignedIn]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Shop' });
  }, [navigation]);
  const onPressWallet = useCallback(
    () => navigation.navigate('Main', { screen: 'Wallet' }),
    [navigation],
  );
  const onPressItem = useCallback(
    (id: string) => navigation.navigate('ProductDetail', { id }),
    [navigation],
  );
  const onPressShop = useCallback(
    () => navigation.navigate('Main', { screen: 'Shop' }),
    [navigation],
  );
  const onCheckout = useCallback(
    () => navigation.navigate('ShippingAddress', { fromCart: true }),
    [navigation],
  );

  const onChangeQuantity = useCallback(
    async (line: CartLine, quantity: number) => {
      try {
        await setQuantity(line.item, quantity, line.size, line.color ?? null);
      } catch (error) {
        toast.show({
          title: "Couldn't update your cart",
          message: (error as Error).message,
          tone: 'warning',
        });
      }
    },
    [setQuantity, toast],
  );

  const onRemove = useCallback(
    async (line: CartLine) => {
      try {
        await setQuantity(line.item, 0, line.size, line.color ?? null);
        toast.show({
          title: 'Removed from cart',
          message: line.item.title,
          tone: 'info',
          action: {
            label: 'Undo',
            onPress: () => {
              setQuantity(
                line.item,
                line.quantity,
                line.size,
                line.color ?? null,
              ).catch(() => {});
            },
          },
        });
      } catch (error) {
        toast.show({
          title: "Couldn't remove it",
          message: (error as Error).message,
          tone: 'warning',
        });
      }
    },
    [setQuantity, toast],
  );

  /** Resolves to null when the code applied, or to why it did not. */
  const onApplyCoupon = useCallback(
    async (code: string) => {
      try {
        const next = await applyCoupon(code);
        const applied = next.quote.coupon;
        toast.show({
          title: 'Coupon applied',
          message: applied ? `${applied.code} · ${applied.title}` : code,
          tone: 'success',
        });
        return null;
      } catch (error) {
        return toApiError(error).message;
      }
    },
    [applyCoupon, toast],
  );

  const onRemoveCoupon = useCallback(async () => {
    setRemovingCoupon(true);
    try {
      await removeCoupon();
    } catch (error) {
      toast.show({
        title: "Couldn't remove the coupon",
        message: (error as Error).message,
        tone: 'warning',
      });
    } finally {
      setRemovingCoupon(false);
    }
  }, [removeCoupon, toast]);

  const lines = cart?.lines ?? [];
  const quote = cart?.quote ?? null;
  const quoteLines = useMemo(
    () =>
      new Map(
        (quote?.lines ?? []).map(line => [
          cartLineKey(line.itemId, line.size, line.color),
          line,
        ]),
      ),
    [quote],
  );
  const hasSoldOut = lines.some(line => !line.item.inStock);
  const short = quote?.coinsShort ?? 0;
  const blocked = hasSoldOut || short > 0;

  return (
    <Screen edges={['top']}>
      <ShopPageHeader
        title="My Cart"
        subtitle="Review your items before checkout"
        balance={balance}
        onPressBack={onPressBack}
        onPressBalance={onPressWallet}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isSyncing && cart !== null}
            onRefresh={hydrate}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {cart === null ? (
          <Card radius="xl" style={styles.empty}>
            <EmptyState
              title={
                syncError ? "Couldn't load your cart" : 'Loading your cart'
              }
              message={syncError ?? 'One moment.'}
              actionLabel={syncError ? 'Try again' : undefined}
              onAction={syncError ? hydrate : undefined}
            />
          </Card>
        ) : lines.length === 0 ? (
          <Card radius="xl" style={styles.empty}>
            <EmptyState
              title="Your cart is empty"
              message="Anything you add from the shop lands here, ready to check out."
              actionLabel="Browse the shop"
              onAction={onPressShop}
            />
          </Card>
        ) : (
          <>
            <SecureRedemptionBanner
              title={
                mode === 'money'
                  ? '100% Secure Checkout'
                  : '100% Secure Redemption'
              }
              caption="Your items are safe and will be delivered to you"
            />

            {lines.map(line => {
              const key = cartLineKey(line.item.id, line.size, line.color);
              return (
                <CartLineCard
                  key={key}
                  line={line}
                  quoteLine={quoteLines.get(key)}
                  mode={mode}
                  max={config?.maxQuantityPerLine ?? line.quantity}
                  busy={busyKeys.includes(key)}
                  onChangeQuantity={onChangeQuantity}
                  onRemove={onRemove}
                  onPressItem={onPressItem}
                />
              );
            })}

            {config?.couponsEnabled && quote ? (
              <CouponCard
                coupon={quote.coupon}
                mode={mode}
                currency={quote.currency}
                coinDiscount={quote.inCoins?.discount ?? null}
                busy={removingCoupon}
                onPressApply={() => setCouponSheetOpen(true)}
                onPressRemove={onRemoveCoupon}
              />
            ) : null}

            {quote ? (
              <OrderSummaryCard quote={quote} count={cart.count} />
            ) : null}

            <CartPromiseStrip
              mode={mode}
              deliveryEstimate={config?.deliveryEstimate ?? null}
              returnPolicy={config?.returnPolicy ?? null}
            />
          </>
        )}
      </ScrollView>

      {lines.length > 0 && quote ? (
        <View
          style={[
            styles.bar,
            { paddingBottom: Math.max(insets.bottom, spacing.base) },
          ]}
        >
          {blocked ? (
            <AppText variant="micro" color="warning" center>
              {hasSoldOut
                ? 'Remove the sold-out item to check out.'
                : `You need ${formatCoins(short)} more coins for this order.`}
            </AppText>
          ) : null}
          <HStack align="center" gap="xs">
            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong">You Pay</AppText>
              <PayAmount quote={quote} size="lg" />
            </VStack>
            <View style={styles.grow}>
              <Button
                label="Proceed to Checkout"
                variant="brand"
                fullWidth
                disabled={blocked}
                onPress={onCheckout}
                iconPosition="trailing"
                icon={
                  <Icon
                    as={ChevronRight}
                    size="sm"
                    tint={colors.primaryForeground}
                  />
                }
              />
            </View>
          </HStack>
        </View>
      ) : null}

      <CouponSheet
        visible={couponSheetOpen}
        onClose={() => setCouponSheetOpen(false)}
        onApply={onApplyCoupon}
      />
    </Screen>
  );
};
