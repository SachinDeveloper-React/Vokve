import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight, Coins, Lock, ShieldCheck } from 'lucide-react-native';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner';
import { SecureRedemptionBanner } from '../../components/cart/SecureRedemptionBanner';
import { CheckoutAddressCard } from '../../components/checkout/CheckoutAddressCard';
import { CheckoutCard } from '../../components/checkout/CheckoutCard';
import { CheckoutLineRow } from '../../components/checkout/CheckoutLineRow';
import { CoinDeductionNote } from '../../components/checkout/CoinDeductionNote';
import { Switch } from '../../components/form/Switch';
import { Divider } from '../../components/layout/Divider';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { PayAmount } from '../../components/shop/PayAmount';
import { PriceBreakdown } from '../../components/shop/PriceBreakdown';
import { ShopPageHeader } from '../../components/shop/ShopPageHeader';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { CoinAmount } from '../../components/wallet/CoinAmount';
import { checkoutApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import { useAddresses, useDefaultAddress } from '../../stores/addressesStore';
import { useCart } from '../../stores/cartStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useShopConfig } from '../../stores/shopStore';
import {
  spacing,
  useTheme,
  useThemedStyles,
  type ThemeShape,
} from '../../theme';
import type { PurchaseLine, Quote } from '../../types/models';
import type {
  RootStackParamList,
  RootStackScreenProps,
} from '../../types/navigation';
import { formatCoins, formatMoney } from '../../utils/format';

const makeStyles = ({ spacing: space, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: space.xl, gap: space.base },
    empty: { paddingVertical: space.xl },
    slider: { width: '100%', height: 40 },
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
 * The till (RULES R2–R4, R11–R13, R16, O8): where it ships, what is in it,
 * the coins it takes, and what is left to pay in money.
 *
 * The quote is the server's — subtotal, coupon, shipping, the least and
 * the most coins allowed — and the slider only moves the coins between
 * them; the money that follows is the one line of arithmetic the contract
 * fixes (coins × value), so the figure shown is the figure charged. How
 * much choice there is depends on the shop's payment mode: a coins-only
 * order takes exactly its coins and a money-only one none, so neither has
 * a slider; a split with a fixed share has none either. Coins start at
 * their maximum, because a user who came to spend them should not have to
 * ask; the slider is for the ones who would rather keep some. A coins-only
 * shop has no choice to offer at all, so the panel goes entirely and the
 * coins read from the summary and the wallet pill in the corner.
 *
 * A "Buy now" arrives with its own lines and leaves the basket alone; a
 * checkout from the cart buys the basket — with the coupon it showed
 * applying — and empties it on the server.
 */
export const CheckoutScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RootStackScreenProps<'Checkout'>['route']>();
  const balance = useCoinBalance();
  const config = useShopConfig();

  const cart = useCart();
  // The address the shipping page chose, while it is still in the book;
  // the default when the checkout was opened without one.
  const addresses = useAddresses();
  const fallbackAddress = useDefaultAddress();
  const chosenId = route.params.addressId;
  const address =
    (chosenId ? addresses.find(a => a.id === chosenId) : undefined) ??
    fallbackAddress;
  const delivery = route.params.delivery;

  const fromCart = 'fromCart' in route.params;
  const lines: PurchaseLine[] = useMemo(
    () =>
      'lines' in route.params
        ? route.params.lines
        : (cart?.lines ?? []).map(line => ({
            itemId: line.item.id,
            quantity: line.quantity,
            size: line.size,
            color: line.color ?? null,
          })),
    [cart, route.params],
  );

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [useCoins, setUseCoins] = useState(true);
  const [coins, setCoins] = useState<number | null>(null);
  // The basket's coupon comes along when the basket showed it applying; a
  // "Buy now" has none. The payment page drops it if the till refuses it.
  const couponCode =
    fromCart && cart?.quote.coupon && !cart.quote.coupon.problem
      ? cart.quote.coupon.code
      : null;

  /** Asks the till for its figures; the coins follow the answer's bounds. */
  const fetchQuote = useCallback(async () => {
    if (lines.length === 0) {
      setQuote(null);
      return;
    }
    setQuoteError(null);
    try {
      const result = await checkoutApi.quote(lines, 'max', couponCode);
      setQuote(result);
      setCoins(current =>
        current === null
          ? result.coinsMax
          : Math.min(Math.max(current, result.coinsMin), result.coinsMax),
      );
    } catch (error) {
      setQuoteError(toApiError(error).message);
    }
  }, [couponCode, lines]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  // What the order takes: everything in a coins-only shop (or when the
  // wallet is short, to show what it would take); otherwise the slider's
  // pick, kept between the floor and the ceiling, or none with the switch off.
  const coinsApplied = useMemo(() => {
    if (!quote) return 0;
    if (quote.paymentMode === 'coins' || quote.coinsShort > 0) {
      return quote.coinsMin;
    }
    if (!useCoins && quote.coinsMin === 0) return 0;
    return Math.min(
      Math.max(coins ?? quote.coinsMax, quote.coinsMin),
      quote.coinsMax,
    );
  }, [coins, quote, useCoins]);
  const appliedCoupon =
    quote?.coupon && !quote.coupon.problem ? quote.coupon : null;
  const figures = useMemo(() => {
    if (!quote) return null;
    const coinsValue = coinsApplied * quote.coinValuePaise;
    return {
      currency: quote.currency,
      mrpTotal: quote.mrpTotal,
      discount: quote.discount,
      subtotal: quote.subtotal,
      shipping: quote.shipping,
      coinsApplied,
      coinsValue,
      payable: Math.max(0, quote.total - coinsValue),
      coupon: appliedCoupon,
      inCoins: quote.inCoins,
    };
  }, [appliedCoupon, coinsApplied, quote]);
  const short = quote?.coinsShort ?? 0;
  const itemCount = useMemo(
    () => (quote?.lines ?? []).reduce((sum, line) => sum + line.quantity, 0),
    [quote],
  );
  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Cart');
  }, [navigation]);
  const onPressWallet = useCallback(
    () => navigation.navigate('Main', { screen: 'Wallet' }),
    [navigation],
  );
  const onPressEditCart = useCallback(
    () => navigation.navigate('Cart'),
    [navigation],
  );
  // Changing the address is the shipping page's job: back to it when it is
  // the page underneath, opened afresh when the checkout came another way.
  const onPressAddress = useCallback(() => {
    if (!address) {
      navigation.navigate('AddressForm');
      return;
    }
    const state = navigation.getState();
    if (state.routes[state.index - 1]?.name === 'ShippingAddress') {
      navigation.goBack();
      return;
    }
    navigation.navigate(
      'ShippingAddress',
      'lines' in route.params
        ? { lines: route.params.lines }
        : { fromCart: true },
    );
  }, [address, navigation, route.params]);

  /**
   * On to the payment page with everything settled here: where it goes,
   * how it is handed over, the coins chosen and the coupon that applied.
   * The order itself is placed there, once a way to pay is picked.
   */
  const onContinue = useCallback(() => {
    if (!address) {
      onPressAddress();
      return;
    }
    navigation.navigate('Payment', {
      ...('lines' in route.params
        ? { lines: route.params.lines }
        : { fromCart: true }),
      addressId: address.id,
      delivery,
      coins: coinsApplied,
      couponCode: appliedCoupon?.code ?? null,
    });
  }, [
    address,
    appliedCoupon,
    coinsApplied,
    delivery,
    navigation,
    onPressAddress,
    route.params,
  ]);

  const soldOut = quote?.lines.find(line => !line.inStock) ?? null;
  // The panel is for the split in between: an order of coins-only goods has
  // nothing to decide, and one of money-only goods no coins to decide about.
  // The quote's mode is the order's own, which an item may set (RULES R11).
  const showCoinsPanel =
    quote !== null &&
    quote.paymentMode !== 'coins' &&
    quote.paymentMode !== 'money';

  return (
    <Screen edges={['top']}>
      <ShopPageHeader
        title="Checkout"
        subtitle="Review your order before payment"
        balance={balance}
        onPressBack={onPressBack}
        onPressBalance={onPressWallet}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <EmailVerificationBanner reason="place an order" />

        {lines.length === 0 ? (
          <Card radius="xl" style={styles.empty}>
            <EmptyState
              title="Nothing to check out"
              message="Add something to your cart first."
              actionLabel="Back to the shop"
              onAction={() => navigation.navigate('Main', { screen: 'Shop' })}
            />
          </Card>
        ) : quoteError ? (
          <Card radius="xl" style={styles.empty}>
            <EmptyState
              title="Couldn't price your order"
              message={quoteError}
              actionLabel="Try again"
              onAction={fetchQuote}
            />
          </Card>
        ) : !quote || !figures ? (
          <View style={styles.empty}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <SecureRedemptionBanner
              title="Secure Checkout"
              caption="Your order details are protected and secure"
              trailing={ShieldCheck}
            />

            <CheckoutAddressCard
              address={address}
              delivery={delivery}
              onPressChange={onPressAddress}
            />

            <CheckoutCard
              title="Order Items"
              action={
                fromCart
                  ? { label: 'Edit Cart', onPress: onPressEditCart }
                  : undefined
              }
            >
              {quote.lines.map((line, index) => (
                <React.Fragment
                  key={`${line.itemId}:${line.size ?? ''}:${line.color ?? ''}`}
                >
                  {index > 0 ? <Divider /> : null}
                  <CheckoutLineRow
                    line={line}
                    currency={quote.currency}
                    inCoins={quote.inCoins !== null}
                  />
                </React.Fragment>
              ))}
            </CheckoutCard>

            {showCoinsPanel ? (
              <CheckoutCard title="Use Your Coins" icon={Coins}>
                {quote.coinsMax === 0 && quote.coinsMin === 0 ? (
                  <AppText variant="micro" color="textTertiary">
                    {Math.floor(balance) === 0
                      ? 'Earn coins by walking and training, and put them towards your next order.'
                      : 'No coins can go towards this order.'}
                  </AppText>
                ) : quote.coinsMin === 0 ? (
                  <Switch
                    label="Pay with coins"
                    helper={`Up to ${formatCoins(quote.coinsMax)} coins${
                      config
                        ? ` (${Math.round(
                            config.coinShareMax * 100,
                          )}% of the items)`
                        : ''
                    } · you have ${formatCoins(Math.floor(balance))}`}
                    value={useCoins}
                    onChange={setUseCoins}
                  />
                ) : (
                  <AppText variant="micro" color="textTertiary">
                    {quote.coinsMin >= quote.coinsMax
                      ? `${formatCoins(quote.coinsMin)} coins${
                          config
                            ? ` (${Math.round(
                                config.coinShareMin * 100,
                              )}% of the items)`
                            : ''
                        } go towards this order · you have ${formatCoins(
                          Math.floor(balance),
                        )}`
                      : `At least ${formatCoins(
                          quote.coinsMin,
                        )} and up to ${formatCoins(
                          quote.coinsMax,
                        )} coins · you have ${formatCoins(
                          Math.floor(balance),
                        )}`}
                  </AppText>
                )}

                {short === 0 &&
                quote.coinsMax > quote.coinsMin &&
                (useCoins || quote.coinsMin > 0) ? (
                  <Slider
                    style={styles.slider}
                    minimumValue={quote.coinsMin}
                    maximumValue={quote.coinsMax}
                    step={1}
                    value={coinsApplied}
                    onValueChange={setCoins}
                    minimumTrackTintColor={colors.gold}
                    maximumTrackTintColor={colors.border}
                    thumbTintColor={colors.gold}
                    accessibilityLabel="Coins to use"
                  />
                ) : null}

                {coinsApplied > 0 ? (
                  <HStack align="center" justify="between">
                    <CoinAmount amount={coinsApplied} size="md" />
                    <AppText
                      variant="bodyStrong"
                      style={{ color: colors.success }}
                    >
                      {`− ${formatMoney(figures.coinsValue, quote.currency)}`}
                    </AppText>
                  </HStack>
                ) : null}

              </CheckoutCard>
            ) : null}

            <CheckoutCard title="Order Summary">
              <PriceBreakdown
                figures={figures}
                count={itemCount}
                itemsLabel="Subtotal"
                emptyCouponLabel={
                  config?.couponsEnabled ? 'Coupon / Discount' : undefined
                }
                payableLabel="Total Payable"
                total={
                  figures.inCoins ? (
                    <PayAmount
                      quote={{
                        coinsApplied: figures.inCoins.total,
                        payable: 0,
                        currency: quote.currency,
                      }}
                      size="md"
                    />
                  ) : (
                    <AppText
                      variant="h3"
                      style={{ color: colors.brandAccent }}
                    >
                      {formatMoney(figures.payable, quote.currency)}
                    </AppText>
                  )
                }
              />
            </CheckoutCard>

            {short === 0 ? (
              <CoinDeductionNote
                coins={coinsApplied}
                payable={figures.payable}
                currency={quote.currency}
              />
            ) : null}
          </>
        )}
      </ScrollView>

      {quote && figures && lines.length > 0 ? (
        <View
          style={[
            styles.bar,
            { paddingBottom: Math.max(insets.bottom, spacing.base) },
          ]}
        >
          {soldOut ? (
            <AppText variant="micro" color="warning" center>
              {`${soldOut.title} is sold out — remove it to continue.`}
            </AppText>
          ) : short > 0 ? (
            <AppText variant="micro" color="warning" center>
              {`You need ${formatCoins(short)} more coins for this order.`}
            </AppText>
          ) : null}

          <HStack align="center" gap="xs">
            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong">You Pay</AppText>
              <PayAmount
                quote={{
                  coinsApplied,
                  payable: figures.payable,
                  currency: quote.currency,
                }}
                size="lg"
              />
            </VStack>
            <View style={styles.grow}>
              <Button
                // label={
                //   !address
                //     ? 'Add a delivery address'
                //     : short > 0
                //     ? 'Not enough coins'
                //     : 'Continue to Payment'
                // }
                label={
                  !address
                    ? 'Add a delivery address'
                    : short > 0
                    ? 'Not enough coins'
                    : 'Continue to Payment'
                }
                variant="brand"
                fullWidth
                disabled={soldOut !== null || (address !== null && short > 0)}
                onPress={onContinue}
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

          <HStack align="center" justify="center" gap="xs">
            <Icon as={Lock} size="xs" tint={colors.success} />
            <AppText variant="micro" style={{ color: colors.success }}>
              100% Secure Checkout
            </AppText>
          </HStack>
        </View>
      ) : null}
    </Screen>
  );
};
