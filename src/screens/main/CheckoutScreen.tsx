import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MapPin, ShieldCheck } from 'lucide-react-native';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner';
import { formatAddressLines } from '../../components/address/AddressCard';
import { useToast } from '../../components/feedback/Toast';
import { Pressable } from '../../components/form/Pressable';
import { Switch } from '../../components/form/Switch';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { Box } from '../../components/layout/Box';
import { Divider } from '../../components/layout/Divider';
import { HStack, VStack } from '../../components/layout/Stack';
import { Emoji } from '../../components/media/Emoji';
import { Icon } from '../../components/media/Icon';
import { PriceBreakdown } from '../../components/shop/PriceBreakdown';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { CoinAmount } from '../../components/wallet/CoinAmount';
import { checkoutApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import {
  useAddressesStore,
  useDefaultAddress,
} from '../../stores/addressesStore';
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
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { PurchaseLine, Quote } from '../../types/models';
import type {
  RootStackParamList,
  RootStackScreenProps,
} from '../../types/navigation';
import { withAlpha } from '../../utils/color';
import { formatCoins, formatMoney } from '../../utils/format';

const makeStyles = ({ spacing, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl * 2, gap: spacing.md },
    empty: { paddingVertical: spacing.xl },
    art: {
      width: moderateScale(44),
      height: moderateScale(44),
      alignItems: 'center',
      justifyContent: 'center',
    },
    slider: { width: '100%', height: 40 },
    grow: { flex: 1 },
    notice: { borderRadius: spacing.md, padding: spacing.md },
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

/**
 * The till (RULES R2–R4, R11–R13, O8): where it ships, what is in it, how
 * many coins to put towards it, and what is left to pay in money.
 *
 * The quote is the server's — subtotal, shipping, the most coins allowed —
 * and the slider only moves the coins within it; the money that follows
 * is the one line of arithmetic the contract fixes (coins × value), so the
 * figure shown is the figure charged. Coins start at their maximum,
 * because a user who came to spend them should not have to ask; the
 * slider is for the ones who would rather keep some.
 *
 * A "Buy now" arrives with its own lines and leaves the basket alone; a
 * checkout from the cart buys the basket and empties it on the server.
 */
export const CheckoutScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RootStackScreenProps<'Checkout'>['route']>();
  const toast = useToast();
  const balance = useCoinBalance();
  const config = useShopConfig();

  const cart = useCart();
  const address = useDefaultAddress();
  const hydrateAddresses = useAddressesStore(s => s.hydrateFromServer);
  const placeOrder = useCheckoutStore(s => s.placeOrder);
  const resumeAfterStepUp = useCheckoutStore(s => s.resumeAfterStepUp);
  const abandonCheckout = useCheckoutStore(s => s.abandonCheckout);
  const pendingCheckout = usePendingCheckout();
  const isPlacing = useIsPlacingOrder();
  const isPaying = useIsPaying();
  const stepUpToken = useStepUpToken();
  const pendingContact = usePendingContactVerification();

  const fromCart = 'fromCart' in route.params;
  const lines: PurchaseLine[] = useMemo(
    () =>
      'lines' in route.params
        ? route.params.lines
        : (cart?.lines ?? []).map(line => ({
            itemId: line.item.id,
            quantity: line.quantity,
            size: line.size,
          })),
    [cart, route.params],
  );

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [useCoins, setUseCoins] = useState(true);
  const [coins, setCoins] = useState<number | null>(null);

  /** Asks the till for its figures; the coins follow the answer's ceiling. */
  const fetchQuote = useCallback(async () => {
    if (lines.length === 0) {
      setQuote(null);
      return;
    }
    setQuoteError(null);
    try {
      const result = await checkoutApi.quote(lines, 'max');
      setQuote(result);
      setCoins(current =>
        current === null ? result.coinsMax : Math.min(current, result.coinsMax),
      );
    } catch (error) {
      setQuoteError(toApiError(error).message);
    }
  }, [lines]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  const coinsApplied =
    useCoins && quote ? Math.min(coins ?? 0, quote.coinsMax) : 0;
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
      payable: quote.total - coinsValue,
    };
  }, [coinsApplied, quote]);
  const needsStepUp =
    coinsApplied > 0 && coinsApplied >= config.stepUpThreshold;

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Cart');
  }, [navigation]);
  const onPressAddress = useCallback(() => {
    if (address) {
      navigation.navigate('Addresses', { select: true });
    } else {
      navigation.navigate('AddressForm');
    }
  }, [address, navigation]);

  /** What each outcome says to the user, in one place for the first try and the resume. */
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
          navigation.replace('OrderDetail', { id: outcome.order.id });
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
          navigation.replace('OrderDetail', { id: outcome.order.id });
          return;
        case 'failed':
          toast.show({
            title:
              outcome.error.code === 'OUT_OF_STOCK'
                ? 'Sold out'
                : outcome.error.code === 'COINS_OVER_LIMIT' ||
                  outcome.error.code === 'INSUFFICIENT_COINS'
                ? 'Coins changed'
                : "Couldn't place the order",
            message: outcome.error.message,
            tone: 'error',
          });
          if (
            outcome.error.code === 'OUT_OF_STOCK' ||
            outcome.error.code === 'COINS_OVER_LIMIT' ||
            outcome.error.code === 'INSUFFICIENT_COINS'
          ) {
            fetchQuote();
          }
      }
    },
    [fetchQuote, hydrateAddresses, navigation, toast],
  );

  const onConfirm = useCallback(async () => {
    if (!address) {
      onPressAddress();
      return;
    }
    const outcome = await placeOrder({
      lines: fromCart ? undefined : lines,
      fromCart: fromCart || undefined,
      addressId: address.id,
      coins: coinsApplied,
    });
    announce(outcome);
  }, [
    address,
    announce,
    coinsApplied,
    fromCart,
    lines,
    onPressAddress,
    placeOrder,
  ]);

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
      toast.show({ title: 'Checkout cancelled', tone: 'info' });
    }
  }, [abandonCheckout, pendingCheckout, pendingContact, stepUpToken, toast]);

  const busy = isPlacing || isPaying;
  const soldOut = quote?.lines.find(line => !line.inStock) ?? null;

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title="Checkout"
          subtitle={
            quote
              ? `${quote.lines.reduce((sum, line) => sum + line.quantity, 0)} ${
                  quote.lines.length === 1 && quote.lines[0].quantity === 1
                    ? 'item'
                    : 'items'
                }`
              : ' '
          }
        />

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
            <Pressable
              onPress={onPressAddress}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel={
                address ? 'Change delivery address' : 'Add a delivery address'
              }
            >
              <Card radius="xl" padding="base">
                <HStack align="start" gap="md">
                  <Icon as={MapPin} size="lg" tint={colors.primary} />
                  <VStack flex={1} gap="xxs">
                    <HStack align="center" justify="between">
                      <AppText variant="label" color="textSecondary">
                        {address
                          ? `Deliver to · ${address.label}`
                          : 'Delivery address'}
                      </AppText>
                      <AppText variant="micro" color="primary">
                        {address ? 'Change' : 'Add'}
                      </AppText>
                    </HStack>
                    {address ? (
                      <>
                        <AppText variant="body">{address.name}</AppText>
                        {formatAddressLines(address).map(line => (
                          <AppText
                            key={line}
                            variant="caption"
                            color="textSecondary"
                          >
                            {line}
                          </AppText>
                        ))}
                      </>
                    ) : (
                      <AppText variant="caption" color="textSecondary">
                        Add where this should be sent.
                      </AppText>
                    )}
                  </VStack>
                </HStack>
              </Card>
            </Pressable>

            <Card radius="xl" padding="base">
              <VStack gap="md">
                <AppText variant="label" color="textSecondary">
                  Items
                </AppText>
                {quote.lines.map((line, index) => (
                  <React.Fragment key={`${line.itemId}:${line.size ?? ''}`}>
                    {index > 0 ? <Divider /> : null}
                    <HStack align="center" gap="md">
                      <Box bg="muted" radius="lg" style={styles.art}>
                        <Emoji size={moderateScale(22)} label={line.title}>
                          {line.emoji}
                        </Emoji>
                      </Box>
                      <VStack flex={1} gap="xxs">
                        <AppText variant="bodyStrong" numberOfLines={1}>
                          {line.title}
                        </AppText>
                        <AppText variant="micro" color="textTertiary">
                          {[
                            line.size ? `Size ${line.size}` : null,
                            `Qty ${line.quantity}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          {!line.inStock ? ' · Sold out' : ''}
                        </AppText>
                      </VStack>
                      <AppText variant="bodyStrong">
                        {formatMoney(line.lineTotal, quote.currency)}
                      </AppText>
                    </HStack>
                  </React.Fragment>
                ))}
              </VStack>
            </Card>

            <Card radius="xl" padding="base">
              <VStack gap="md">
                {quote.coinsMax > 0 ? (
                  <Switch
                    label="Pay with coins"
                    helper={`Up to ${formatCoins(
                      quote.coinsMax,
                    )} coins (${Math.round(
                      config.coinShareMax * 100,
                    )}% of the items) · you have ${formatCoins(
                      Math.floor(balance),
                    )}`}
                    value={useCoins}
                    onChange={setUseCoins}
                  />
                ) : (
                  <VStack gap="xxs">
                    <AppText variant="label" color="textSecondary">
                      Pay with coins
                    </AppText>
                    <AppText variant="micro" color="textTertiary">
                      {Math.floor(balance) === 0
                        ? 'Earn coins by walking and training, and put them towards your next order.'
                        : 'No coins can go towards this order.'}
                    </AppText>
                  </VStack>
                )}

                {useCoins && quote.coinsMax > 0 ? (
                  <VStack gap="xs">
                    <Slider
                      style={styles.slider}
                      minimumValue={0}
                      maximumValue={quote.coinsMax}
                      step={1}
                      value={coinsApplied}
                      onValueChange={setCoins}
                      minimumTrackTintColor={colors.gold}
                      maximumTrackTintColor={colors.border}
                      thumbTintColor={colors.gold}
                      accessibilityLabel="Coins to use"
                    />
                    <HStack align="center" justify="between">
                      <CoinAmount amount={coinsApplied} size="md" />
                      <AppText
                        variant="bodyStrong"
                        style={{ color: colors.success }}
                      >
                        {`− ${formatMoney(figures.coinsValue, quote.currency)}`}
                      </AppText>
                    </HStack>
                  </VStack>
                ) : null}

                {needsStepUp ? (
                  <HStack
                    align="center"
                    gap="sm"
                    style={[
                      styles.notice,
                      {
                        backgroundColor: withAlpha(
                          colors.primary,
                          isDark ? 0.18 : 0.1,
                        ),
                      },
                    ]}
                  >
                    <Icon as={ShieldCheck} size="sm" tint={colors.primary} />
                    <AppText
                      variant="caption"
                      color="textSecondary"
                      style={styles.grow}
                    >
                      {`${formatCoins(
                        config.stepUpThreshold,
                      )} coins or more in one order — we'll ask for a code first.`}
                    </AppText>
                  </HStack>
                ) : null}
              </VStack>
            </Card>

            <Card radius="xl" padding="base">
              <VStack gap="md">
                <AppText variant="label" color="textSecondary">
                  Summary
                </AppText>
                <PriceBreakdown figures={figures} />
              </VStack>
            </Card>
          </>
        )}
      </ScrollView>

      {quote && figures && lines.length > 0 ? (
        <View style={styles.bar}>
          {soldOut ? (
            <AppText variant="micro" color="warning" center>
              {`${soldOut.title} is sold out — remove it to continue.`}
            </AppText>
          ) : null}
          <Button
            label={
              !address
                ? 'Add a delivery address'
                : figures.payable === 0
                ? `Place order · ${formatCoins(coinsApplied)} coins`
                : needsStepUp
                ? `Confirm & pay ${formatMoney(
                    figures.payable,
                    quote.currency,
                  )}`
                : `Pay ${formatMoney(figures.payable, quote.currency)}`
            }
            variant="brand"
            fullWidth
            loading={busy}
            disabled={busy || soldOut !== null}
            onPress={onConfirm}
          />
        </View>
      ) : null}
    </Screen>
  );
};
