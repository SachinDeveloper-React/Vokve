import React, { useCallback, useEffect } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Pressable } from '../../components/form/Pressable';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { Box } from '../../components/layout/Box';
import { HStack, VStack } from '../../components/layout/Stack';
import { Emoji } from '../../components/media/Emoji';
import { Price } from '../../components/shop/Price';
import { PriceBreakdown } from '../../components/shop/PriceBreakdown';
import { QuantityStepper } from '../../components/shop/QuantityStepper';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { CoinAmount } from '../../components/wallet/CoinAmount';
import { useToast } from '../../components/feedback/Toast';
import { useAuthStatus } from '../../stores/authStore';
import { useCart, useCartLineBusy, useCartStore } from '../../stores/cartStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useShopConfig } from '../../stores/shopStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { CartLine } from '../../types/models';
import { formatMoney } from '../../utils/format';

const makeStyles = ({ spacing, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl * 2, gap: spacing.md },
    empty: { paddingVertical: spacing.xl },
    art: {
      width: moderateScale(64),
      height: moderateScale(64),
      alignItems: 'center',
      justifyContent: 'center',
    },
    soldOut: { opacity: 0.5 },
    bar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.base,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      gap: spacing.xs,
    },
  });

interface LineProps {
  line: CartLine;
  max: number;
  onChangeQuantity: (line: CartLine, quantity: number) => void;
  onPressItem: (id: string) => void;
}

const CartLineRow = ({
  line,
  max,
  onChangeQuantity,
  onPressItem,
}: LineProps) => {
  const styles = useThemedStyles(makeStyles);
  const busy = useCartLineBusy(line.item.id, line.size);
  const change = useCallback(
    (quantity: number) => onChangeQuantity(line, quantity),
    [line, onChangeQuantity],
  );
  const open = useCallback(
    () => onPressItem(line.item.id),
    [line.item.id, onPressItem],
  );

  return (
    <Card radius="xl" padding="md">
      <HStack align="center" gap="md">
        <Pressable
          onPress={open}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel={`${line.item.title}, view details`}
        >
          <Box
            bg="muted"
            radius="lg"
            style={[styles.art, !line.item.inStock && styles.soldOut]}
          >
            <Emoji size={moderateScale(32)} label={line.item.title}>
              {line.item.emoji}
            </Emoji>
          </Box>
        </Pressable>
        <VStack flex={1} gap="xs">
          <AppText variant="bodyStrong" numberOfLines={2}>
            {line.item.title}
          </AppText>
          {line.size ? (
            <AppText
              variant="micro"
              color="textSecondary"
            >{`Size ${line.size}`}</AppText>
          ) : null}
          <Price
            price={line.item.price}
            mrp={line.item.mrp}
            currency={line.item.currency}
            size="sm"
            hideDiscount
          />
          {!line.item.inStock ? (
            <AppText variant="micro" color="warning">
              Sold out — remove it to check out
            </AppText>
          ) : null}
          <HStack align="center" justify="between">
            <QuantityStepper
              value={line.quantity}
              max={max}
              onChange={change}
              busy={busy}
              removable
              label={line.item.title}
            />
            <AppText variant="bodyStrong">
              {formatMoney(line.item.price * line.quantity, line.item.currency)}
            </AppText>
          </HStack>
        </VStack>
      </HStack>
    </Card>
  );
};

/**
 * The basket: every line with its stepper, and what checking out would
 * cost with as many coins as the wallet allows.
 *
 * The quote at the bottom is the server's, refreshed with every change,
 * so the figure a user sees here is the one the checkout opens with. The
 * button is the only way on; a sold-out line blocks it, because the till
 * would refuse the order and this is the place to fix it.
 */
export const CartScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const toast = useToast();
  const balance = useCoinBalance();
  const config = useShopConfig();
  const isSignedIn = useAuthStatus() === 'authenticated';

  const cart = useCart();
  const isSyncing = useCartStore(s => s.isSyncing);
  const syncError = useCartStore(s => s.syncError);
  const hydrate = useCartStore(s => s.hydrateFromServer);
  const setQuantity = useCartStore(s => s.setQuantity);

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
  const onPressItem = useCallback(
    (id: string) => navigation.navigate('ProductDetail', { id }),
    [navigation],
  );
  const onPressShop = useCallback(
    () => navigation.navigate('Main', { screen: 'Shop' }),
    [navigation],
  );
  const onPressOrders = useCallback(
    () => navigation.navigate('Orders'),
    [navigation],
  );
  const onCheckout = useCallback(
    () => navigation.navigate('Checkout', { fromCart: true }),
    [navigation],
  );

  const onChangeQuantity = useCallback(
    async (line: CartLine, quantity: number) => {
      try {
        await setQuantity(line.item, quantity, line.size);
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

  const lines = cart?.lines ?? [];
  const hasSoldOut = lines.some(line => !line.item.inStock);
  const quote = cart?.quote ?? null;

  return (
    <Screen edges={['top']}>
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
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title="Cart"
          subtitle={
            cart === null
              ? ' '
              : cart.count === 0
              ? 'Nothing in it yet'
              : `${cart.count} ${cart.count === 1 ? 'item' : 'items'}`
          }
        />

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
              message="Anything you add from the shop lands here, ready to check out with coins and money."
              actionLabel="Browse the shop"
              onAction={onPressShop}
            />
          </Card>
        ) : (
          <>
            {lines.map(line => (
              <CartLineRow
                key={`${line.item.id}:${line.size ?? ''}`}
                line={line}
                max={config?.maxQuantityPerLine ?? line.quantity}
                onChangeQuantity={onChangeQuantity}
                onPressItem={onPressItem}
              />
            ))}

            {quote ? (
              <Card radius="xl" padding="base">
                <VStack gap="md">
                  <AppText variant="label" color="textSecondary">
                    Estimate
                  </AppText>
                  <PriceBreakdown figures={quote} />
                  {quote.coinsMax > 0 ? (
                    <HStack align="center" gap="xs" wrap>
                      <AppText variant="micro" color="textSecondary">
                        Up to
                      </AppText>
                      <CoinAmount amount={quote.coinsMax} size="sm" />
                      <AppText variant="micro" color="textSecondary">
                        can go towards this order — choose how many at checkout.
                      </AppText>
                    </HStack>
                  ) : null}
                </VStack>
              </Card>
            ) : null}

            <Pressable
              onPress={onPressOrders}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel="My orders"
            >
              <AppText variant="caption" color="primary" center>
                Looking for something you already bought? My orders
              </AppText>
            </Pressable>
          </>
        )}
      </ScrollView>

      {lines.length > 0 && quote ? (
        <View style={styles.bar}>
          {hasSoldOut ? (
            <AppText variant="micro" color="warning" center>
              Remove the sold-out item to check out.
            </AppText>
          ) : null}
          <Button
            label={`Checkout · ${formatMoney(quote.payable, quote.currency)}`}
            variant="brand"
            fullWidth
            disabled={hasSoldOut}
            onPress={onCheckout}
          />
        </View>
      ) : null}
    </Screen>
  );
};
