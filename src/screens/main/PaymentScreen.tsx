import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight, Coins, Wallet } from 'lucide-react-native';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner';
import { SecureRedemptionBanner } from '../../components/cart/SecureRedemptionBanner';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { CheckoutCard } from '../../components/checkout/CheckoutCard';
import { CheckoutLineRow } from '../../components/checkout/CheckoutLineRow';
import { PaymentMethodOption } from '../../components/checkout/PaymentMethodOption';
import { useToast } from '../../components/feedback/Toast';
import { Divider } from '../../components/layout/Divider';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { PayAmount } from '../../components/shop/PayAmount';
import { ShopPageHeader } from '../../components/shop/ShopPageHeader';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { Pressable } from '../../components/form/Pressable';
import { appApi, checkoutApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import { useAddressesStore } from '../../stores/addressesStore';
import {
  usePendingContactVerification,
  useStepUpToken,
} from '../../stores/authStore';
import { useCart } from '../../stores/cartStore';
import {
  useCheckoutStore,
  useIsPaying,
  useIsPlacingOrder,
  usePendingCheckout,
  type CheckoutOutcome,
} from '../../stores/checkoutStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useShopConfig } from '../../stores/shopStore';
import {
  spacing,
  useTheme,
  useThemedStyles,
  type ThemeShape,
} from '../../theme';
import type { PaymentMethod, PurchaseLine, Quote } from '../../types/models';
import type {
  RootStackParamList,
  RootStackScreenProps,
} from '../../types/navigation';
import { withAlpha } from '../../utils/color';
import { formatCoins, formatMoney } from '../../utils/format';

const makeStyles = ({ spacing: space, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: space.xl, gap: space.base },
    empty: { paddingVertical: space.xl },
    note: {
      borderRadius: space.md,
      borderWidth: 1,
      paddingVertical: space.md,
      paddingHorizontal: space.base,
    },
    grow: { flex: 1 },
    terms: { textDecorationLine: 'underline' },
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

/** The shop's name for its gateway, for the line that says who secured this. */
const PROVIDER_NAME: Record<string, string | null> = {
  razorpay: 'Razorpay',
  // Nothing is really secured by a mock, so the line is left off rather
  // than claiming a gateway the build does not have.
  mock: null,
};

/**
 * How the order is paid (RULES R12): the last page before the money moves.
 *
 * The methods are the server's (⚙ `commerce.paymentMethods`, narrowed by
 * the payment mode), and which of them this order can use is the quote's:
 * "Pay with Coins" only where the wallet clears the whole bill, "Coins +
 * UPI / Card" only where it clears part, and a gateway on its own only
 * where the shop forces no coins. A method the sums rule out is shown
 * greyed rather than hidden, so a member can see why.
 *
 * Picking one decides the coins the order takes, and the money that
 * follows is the single line of arithmetic the contract fixes (coins ×
 * value) — so the figure under "You Pay" is the figure charged. "Pay Now"
 * places the order with the method on it; the server checks the two agree
 * before it takes anything, and a step-up parks the attempt here exactly
 * as it used to at the till.
 */
export const PaymentScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RootStackScreenProps<'Payment'>['route']>();
  const toast = useToast();
  const balance = useCoinBalance();
  // Only for the gateway's name under the secure banner; what this order
  // can be paid by comes from the quote.
  const config = useShopConfig();
  const cart = useCart();

  const { addressId, delivery, couponCode } = route.params;
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

  const hydrateAddresses = useAddressesStore(s => s.hydrateFromServer);
  const placeOrder = useCheckoutStore(s => s.placeOrder);
  const resumeAfterStepUp = useCheckoutStore(s => s.resumeAfterStepUp);
  const abandonCheckout = useCheckoutStore(s => s.abandonCheckout);
  const pendingCheckout = usePendingCheckout();
  const isPlacing = useIsPlacingOrder();
  const isPaying = useIsPaying();
  const stepUpToken = useStepUpToken();
  const pendingContact = usePendingContactVerification();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<PaymentMethod | null>(null);
  const [termsUrl, setTermsUrl] = useState<string | null>(null);
  // The checkout's coupon rides along; dropped here if the till says it
  // stopped applying, so the figures shown are the ones charged.
  const [couponDropped, setCouponDropped] = useState(false);
  /** Open while the member is being asked to confirm a coins-only order. */
  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const coupon = couponDropped ? null : couponCode ?? null;

  /** The till's figures at the most coins this order may take. */
  const fetchQuote = useCallback(async () => {
    if (lines.length === 0) {
      setQuote(null);
      return;
    }
    setQuoteError(null);
    try {
      setQuote(await checkoutApi.quote(lines, 'max', coupon));
    } catch (error) {
      setQuoteError(toApiError(error).message);
    }
  }, [coupon, lines]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  // The legal line under the button links where the About page links.
  useEffect(() => {
    let cancelled = false;
    appApi
      .about()
      .then(about => {
        if (!cancelled) setTermsUrl(about.links.terms);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * What each way of paying takes from the wallet: everything it may for
   * "Pay with Coins", the checkout's own pick for the split, and only what
   * the shop forces for a gateway on its own.
   */
  const coinsFor = useCallback(
    (method: PaymentMethod): number => {
      if (!quote) return 0;
      if (method === 'coins') return quote.coinsMax;
      if (method === 'coins_upi') {
        return Math.min(
          Math.max(route.params.coins, quote.coinsMin),
          quote.coinsMax,
        );
      }
      return quote.coinsMin;
    },
    [quote, route.params.coins],
  );
  const payableFor = useCallback(
    (method: PaymentMethod): number =>
      quote
        ? Math.max(0, quote.total - coinsFor(method) * quote.coinValuePaise)
        : 0,
    [coinsFor, quote],
  );
  // What this order can be paid by is the till's own answer, not a rule
  // the app reworks: an order of coins-only goods comes back with nothing
  // but `coins`, and that is the one row the page draws.
  const offered = useMemo(() => quote?.paymentMethods ?? [], [quote]);
  const takesCoins = offered.some(m => m === 'coins' || m === 'coins_upi');

  // The way the checkout left things, where the order still allows it;
  // otherwise the first the till offers. Re-run when a quote lands.
  useEffect(() => {
    if (offered.length === 0) {
      setChosen(null);
      return;
    }
    setChosen(current => {
      if (current && offered.includes(current)) return current;
      const implied: PaymentMethod =
        route.params.coins > 0 ? 'coins_upi' : 'upi';
      return offered.includes(implied) ? implied : offered[0];
    });
  }, [offered, route.params.coins]);

  const coins = chosen ? coinsFor(chosen) : 0;
  const payable = chosen ? payableFor(chosen) : (quote?.total ?? 0);
  const itemCount = useMemo(
    () => (quote?.lines ?? []).reduce((sum, line) => sum + line.quantity, 0),
    [quote],
  );
  const soldOut = quote?.lines.find(line => !line.inStock) ?? null;
  const short = quote?.coinsShort ?? 0;

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
  const onPressTerms = useCallback(async () => {
    if (!termsUrl) return;
    try {
      await Linking.openURL(termsUrl);
    } catch {
      toast.show({
        title: "Couldn't open that",
        message: 'No app on this phone can open the link.',
        tone: 'warning',
      });
    }
  }, [termsUrl, toast]);

  /** What each outcome says, in one place for the first try and the resume. */
  const announce = useCallback(
    (outcome: CheckoutOutcome) => {
      switch (outcome.status) {
        case 'placed':
          toast.show({
            title: 'Order placed',
            message:
              outcome.order.coinsUsed > 0
                ? `${formatCoins(outcome.order.coinsUsed)} coins used${
                    outcome.order.payable > 0
                      ? ` and ${formatMoney(
                          outcome.order.payable,
                          outcome.order.currency,
                        )} paid`
                      : ''
                  }.`
                : `${formatMoney(
                    outcome.order.payable,
                    outcome.order.currency,
                  )} paid.`,
            tone: 'success',
          });
          navigation.replace('OrderConfirmation', { id: outcome.order.id });
          return;
        case 'step_up_required':
          // The OTP screen is opening over this one.
          return;
        case 'address_required':
          hydrateAddresses();
          toast.show({
            title: 'Add a delivery address first',
            message: 'Tell us where to send it.',
            tone: 'warning',
          });
          navigation.navigate('AddressForm');
          return;
        case 'payment_pending':
          toast.show({
            title: 'Order saved, payment pending',
            message:
              outcome.error?.message ??
              'Pay for it from the order page before the window closes.',
            tone: 'info',
            durationMs: 6000,
          });
          // Held but not paid for: the confirmation page words that, and
          // carries the way to finish it.
          navigation.replace('OrderConfirmation', { id: outcome.order.id });
          return;
        case 'failed': {
          const code = outcome.error.code ?? '';
          const couponGone = code.startsWith('COUPON');
          const methodGone = code.startsWith('PAYMENT_METHOD');
          const coinsChanged =
            code === 'COINS_OVER_LIMIT' ||
            code === 'COINS_UNDER_MINIMUM' ||
            code === 'INSUFFICIENT_COINS';
          toast.show({
            title:
              code === 'OUT_OF_STOCK'
                ? 'Sold out'
                : coinsChanged
                ? 'Coins changed'
                : couponGone
                ? 'Coupon no longer applies'
                : methodGone
                ? "That way of paying won't work"
                : "Couldn't place the order",
            message: couponGone
              ? `${outcome.error.message} Check the new total before you pay.`
              : outcome.error.message,
            tone: 'error',
          });
          if (couponGone) {
            // Re-quoted without it by the effect, so the new total is shown.
            setCouponDropped(true);
          } else if (code === 'OUT_OF_STOCK' || coinsChanged || methodGone) {
            // The sums moved underneath the pick: ask again and let the
            // list work out afresh what this order can be paid with.
            fetchQuote();
          }
        }
      }
    },
    [fetchQuote, hydrateAddresses, navigation, toast],
  );

  const place = useCallback(async () => {
    if (!chosen) return;
    const outcome = await placeOrder({
      lines: fromCart ? undefined : lines,
      fromCart: fromCart || undefined,
      addressId,
      coins,
      couponCode: coupon ?? undefined,
      delivery,
      paymentMethod: chosen,
    });
    announce(outcome);
  }, [
    addressId,
    announce,
    chosen,
    coins,
    coupon,
    delivery,
    fromCart,
    lines,
    placeOrder,
  ]);

  /**
   * An order the coins cover has no gateway to put itself in front of the
   * member: nothing would open, the wallet would simply be lighter. So the
   * app asks here, once, in plain figures — how many coins, and what is
   * left afterwards — and the tap on the sheet is the consent.
   *
   * An order with money in it asks nothing: the gateway's own sheet is
   * where that order is confirmed, and a second question before it would
   * only be a door to open before a door.
   */
  const coinsOnly = coins > 0 && payable === 0;

  const confirmActions = useMemo(
    () => [
      {
        label: `Use ${formatCoins(coins)} coins`,
        icon: Coins,
        onPress: place,
      },
    ],
    [coins, place],
  );

  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  const onPay = useCallback(() => {
    if (!chosen) return;
    if (coinsOnly) {
      setConfirmOpen(true);
      return;
    }
    place();
  }, [chosen, coinsOnly, place]);

  // The step-up came back with a token: finish what it interrupted.
  useEffect(() => {
    if (!stepUpToken || !pendingCheckout) {
      return;
    }
    resumeAfterStepUp().then(outcome => {
      if (outcome) {
        announce(outcome);
      }
    });
  }, [announce, pendingCheckout, resumeAfterStepUp, stepUpToken]);

  // The OTP screen closed without a token — the user backed out.
  useEffect(() => {
    if (pendingCheckout && !pendingContact && !stepUpToken) {
      abandonCheckout();
      toast.show({ title: 'Payment cancelled', tone: 'info' });
    }
  }, [abandonCheckout, pendingCheckout, pendingContact, stepUpToken, toast]);

  const busy = isPlacing || isPaying;
  const provider = config ? PROVIDER_NAME[config.paymentProvider] ?? null : null;

  return (
    <Screen edges={['top']}>
      <ShopPageHeader
        title="Payment"
        subtitle="Choose your payment method"
        balance={balance}
        onPressBack={onPressBack}
        onPressBalance={onPressWallet}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <EmailVerificationBanner reason="place an order" />

        {lines.length === 0 ? (
          <Card radius="xl" style={styles.empty}>
            <EmptyState
              title="Nothing to pay for"
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
        ) : !quote ? (
          <View style={styles.empty}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <Card radius="xl" padding="base">
              <VStack gap="md">
                {quote.lines.map((line, index) => (
                  <React.Fragment
                    key={`${line.itemId}:${line.size ?? ''}:${
                      line.color ?? ''
                    }`}
                  >
                    {index > 0 ? <Divider /> : null}
                    <CheckoutLineRow
                      line={line}
                      currency={quote.currency}
                      inCoins={quote.inCoins !== null}
                    />
                  </React.Fragment>
                ))}
              </VStack>
            </Card>

            {takesCoins ? (
              <HStack
                align="center"
                gap="md"
                style={[
                  styles.note,
                  {
                    backgroundColor: withAlpha(
                      colors.gold,
                      isDark ? 0.16 : 0.08,
                    ),
                    borderColor: withAlpha(colors.gold, isDark ? 0.35 : 0.2),
                  },
                ]}
              >
                <Icon as={Wallet} size="md" tint={colors.gold} />
                <VStack flex={1} gap="xxs">
                  <AppText variant="bodyStrong">
                    Pay using coins or coins + cash
                  </AppText>
                  <AppText variant="micro" color="textSecondary">
                    Use your coin balance or combine with other payment
                    methods.
                  </AppText>
                </VStack>
              </HStack>
            ) : null}

            <CheckoutCard title="Select Payment Method">
              {offered.length === 0 ? (
                <AppText variant="caption" color="textSecondary">
                  No way to pay is available right now. Please try again in a
                  moment.
                </AppText>
              ) : (
                <VStack gap="sm" accessibilityRole="radiogroup">
                  {offered.map(method => {
                    const selected = method === chosen;
                    const takes = coinsFor(method);
                    return (
                      <PaymentMethodOption
                        key={method}
                        method={method}
                        selected={selected}
                        onSelect={setChosen}
                        amount={
                          selected ? (
                            <PayAmount
                              quote={{
                                coinsApplied: takes,
                                payable: payableFor(method),
                                currency: quote.currency,
                              }}
                              size="md"
                            />
                          ) : undefined
                        }
                        note={
                          selected && takes > 0
                            ? `Available: ${formatCoins(
                                Math.floor(balance),
                              )} coins`
                            : undefined
                        }
                      />
                    );
                  })}
                </VStack>
              )}
            </CheckoutCard>

            <SecureRedemptionBanner
              title="100% Secure Payment"
              caption="Your payment information is safe with us"
              trailingLabel={provider ? `Secured by ${provider}` : undefined}
            />

            <CheckoutCard title="Order Summary">
              <VStack gap="sm">
                <HStack align="center" justify="between">
                  <AppText variant="body" color="textSecondary">
                    Total Items
                  </AppText>
                  <AppText variant="body">{String(itemCount)}</AppText>
                </HStack>
                <HStack align="center" justify="between">
                  <AppText variant="body" color="textSecondary">
                    Total Price
                  </AppText>
                  <AppText variant="body">
                    {quote.inCoins
                      ? `${formatCoins(quote.inCoins.total)} coins`
                      : formatMoney(quote.total, quote.currency)}
                  </AppText>
                </HStack>
                <Divider />
                <HStack align="center" justify="between">
                  <AppText variant="bodyStrong">You Pay</AppText>
                  <PayAmount
                    quote={{
                      coinsApplied: coins,
                      payable,
                      currency: quote.currency,
                    }}
                    size="md"
                  />
                </HStack>
              </VStack>
            </CheckoutCard>
          </>
        )}
      </ScrollView>

      {quote && lines.length > 0 ? (
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

          <Button
            label={coinsOnly ? 'Redeem with Coins' : 'Pay Now'}
            variant="brand"
            size="lg"
            fullWidth
            loading={busy}
            disabled={busy || chosen === null || soldOut !== null || short > 0}
            onPress={onPay}
            iconPosition="trailing"
            icon={
              <Icon
                as={ChevronRight}
                size="sm"
                tint={colors.primaryForeground}
              />
            }
          />

          <HStack align="center" justify="center" gap="xxs" wrap>
            <AppText variant="micro" color="textTertiary">
              By continuing, you agree to our
            </AppText>
            <Pressable
              onPress={onPressTerms}
              feedback="opacity"
              hitSlop={8}
              disabled={!termsUrl}
              accessibilityRole="link"
              accessibilityLabel="Terms & Conditions"
            >
              <AppText variant="micro" color="primary" style={styles.terms}>
                Terms & Conditions
              </AppText>
            </Pressable>
          </HStack>
        </View>
      ) : null}
      <ActionSheet
        visible={isConfirmOpen}
        onClose={closeConfirm}
        title="Confirm your coins"
        message={
          quote
            ? `${formatCoins(coins)} coins will be taken from your wallet for ${
                itemCount === 1 ? 'this item' : `these ${itemCount} items`
              }. You will have ${formatCoins(
                Math.max(0, Math.floor(balance) - coins),
              )} left.`
            : undefined
        }
        actions={confirmActions}
        cancelLabel="Not now"
      />
    </Screen>
  );
};
