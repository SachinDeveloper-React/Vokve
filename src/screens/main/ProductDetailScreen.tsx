import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CircleCheck,
  RotateCcw,
  Ruler,
  Star,
  Truck,
} from 'lucide-react-native';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { ColorSwatchPicker } from '../../components/shop/ColorSwatchPicker';
import { PayAmount } from '../../components/shop/PayAmount';
import { ProductFeatureGrid } from '../../components/shop/ProductFeatureGrid';
import { ProductGallery } from '../../components/shop/ProductGallery';
import {
  ProductInfoCard,
  type ProductInfoRow,
} from '../../components/shop/ProductInfoCard';
import { SPEC_ICONS } from '../../components/shop/productIcons';
import { ShopPageHeader } from '../../components/shop/ShopPageHeader';
import { SizePicker } from '../../components/shop/SizePicker';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { CoinAmount } from '../../components/wallet/CoinAmount';
import { checkoutApi, shopApi } from '../../services/api/endpoints';
import { useCoinBalance } from '../../stores/coinsStore';
import {
  usePaymentMode,
  useShopConfig,
  useShopItem,
  useShopStore,
} from '../../stores/shopStore';
import {
  spacing,
  useTheme,
  useThemedStyles,
  type ThemeShape,
} from '../../theme';
import type { Quote, ShopItem } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';
import { withAlpha } from '../../utils/color';
import { formatCoins, formatMoney } from '../../utils/format';

const makeStyles = ({ spacing: space, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: space.xl, gap: space.xl },
    column: { flex: 1 },
    ribbon: {
      alignSelf: 'flex-start',
      paddingVertical: space.xs,
      paddingHorizontal: space.md,
      borderRadius: 999,
      backgroundColor: withAlpha(colors.brandAccent, 0.16),
    },
    brand: { color: colors.brandAccent },
    unit: { fontWeight: '600' },
    struck: { textDecorationLine: 'line-through' },
    empty: { paddingVertical: space.xl },
    /** Bleeds through the screen's gutter so the rule runs edge to edge. */
    bar: {
      marginHorizontal: -space.base,
      paddingHorizontal: space.base,
      paddingTop: space.md,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.base,
    },
  });

/**
 * One item in full, laid out as a redemption: photos and the facts that
 * sell it side by side, the colour and size to choose, the key features,
 * the product information, and what it will cost with the coins the
 * wallet holds.
 *
 * The page reads the shelf's copy at once and asks the server for a fresh
 * one on arrival — stock changes by the hour, and a deep link lands here
 * with no copy at all. The price reads the way the shop takes payment: in
 * coins in a coins-only shop, in rupees in a money-only one, and in rupees
 * with the coins that may go towards it in a mixed one (RULES R11). "You
 * Pay" is the till's own quote for one of this item at the most coins
 * allowed, shipping included, so the figure here is the figure the
 * checkout opens with; the app never sums its own split. "Redeem Now"
 * takes exactly this line on — to the shipping page, then the till,
 * where the coins can still be changed — and leaves the basket as it was,
 * unless the wallet is short of what the order must take, which is said
 * here instead.
 */
export const ProductDetailScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'ProductDetail'>['route']>();
  const { id } = route.params;

  const cached = useShopItem(id);
  const upsertItem = useShopStore(s => s.upsertItem);
  const config = useShopConfig();
  const shopMode = usePaymentMode();
  const balance = useCoinBalance();
  const wholeCoins = Math.floor(balance);

  const [fetched, setFetched] = useState<ShopItem | null>(null);
  const [isLoading, setLoading] = useState(cached === null);
  const item = fetched ?? cached;
  // How *this* item is bought (RULES R11): its own mode, or the shop's
  // while the item itself has not arrived.
  const mode = item?.paymentMode ?? shopMode;

  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);

  // Fresh stock, and the whole item for a deep link.
  useEffect(() => {
    let cancelled = false;
    shopApi
      .item(id)
      .then(result => {
        if (cancelled) return;
        setFetched(result);
        upsertItem(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, upsertItem]);

  // The first colour is picked to begin with, as the swatches show it; a
  // colour no longer offered after a refresh falls back to the first again.
  const colorNames = item?.colors.map(c => c.name).join('|') ?? '';
  useEffect(() => {
    if (!item || item.colors.length === 0) {
      setColor(null);
      return;
    }
    setColor(current =>
      current && item.colors.some(c => c.name === current)
        ? current
        : item.colors[0].name,
    );
    // Keyed on the names so a refetch of the same item does not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorNames]);

  // The till's figure for one unit. A sized item is quoted at its first
  // size until one is picked — the price is the same in every size, and
  // the server will not quote a sized line without one.
  const quoteSize =
    item && item.sizes.length > 0 ? size ?? item.sizes[0] : null;
  const ready = item !== null && (item.colors.length === 0 || color !== null);
  useEffect(() => {
    if (!item || !ready) return;
    let cancelled = false;
    checkoutApi
      .quote([{ itemId: item.id, quantity: 1, size: quoteSize, color }], 'max')
      .then(result => {
        if (!cancelled) setQuote(result);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      });
    return () => {
      cancelled = true;
    };
    // The price and stock that matter are re-read with the item itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.price, ready, quoteSize, color, wholeCoins]);

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

  const onChangeSize = useCallback((value: string) => {
    setSize(value);
    setSizeError(null);
  }, []);

  const onRedeem = useCallback(() => {
    if (!item) return;
    if (item.sizes.length > 0 && !size) {
      setSizeError('Pick a size first.');
      return;
    }
    navigation.navigate('ShippingAddress', {
      lines: [{ itemId: item.id, quantity: 1, size, color }],
    });
  }, [color, item, navigation, size]);

  const short = (quote?.coinsShort ?? 0) > 0;

  const facts = useMemo<ProductInfoRow[]>(() => {
    if (!item) return [];
    const rows = item.highlights.map(spec => ({
      icon: SPEC_ICONS[spec.icon],
      label: spec.label,
      value: spec.value,
    }));
    if (item.sizes.length > 0) {
      rows.push({
        icon: Ruler,
        label: 'Sizes Available',
        value: item.sizes.join(', '),
      });
    }
    return rows;
  }, [item]);

  const infoRows = useMemo<ProductInfoRow[]>(() => {
    if (!item) return [];
    const rows: ProductInfoRow[] = item.specs.map(spec => ({
      icon: SPEC_ICONS[spec.icon],
      label: spec.label,
      value: spec.value,
    }));
    if (config?.deliveryEstimate) {
      rows.push({
        icon: Truck,
        label: 'Delivery',
        value: config.deliveryEstimate,
      });
    }
    if (config?.returnPolicy) {
      rows.push({
        icon: RotateCcw,
        label: 'Return Policy',
        value: config.returnPolicy,
      });
    }
    return rows;
  }, [config, item]);

  return (
    <Screen edges={['top']}>
      <ShopPageHeader
        title="Product Details"
        subtitle="Redeem your favorite products"
        balance={balance}
        onPressBack={onPressBack}
        onPressBalance={onPressWallet}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {!item ? (
          <Card radius="xl" style={styles.empty}>
            <EmptyState
              title={isLoading ? 'Loading' : "Couldn't find that item"}
              message={
                isLoading ? 'One moment.' : 'It may have been taken off sale.'
              }
              actionLabel={isLoading ? undefined : 'Back to the shop'}
              onAction={isLoading ? undefined : onPressBack}
            />
          </Card>
        ) : (
          <>
            <HStack gap="base" align="start">
              <View style={styles.column}>
                <ProductGallery item={item} />
              </View>

              <VStack gap="md" style={styles.column}>
                <AppText variant="h2">{item.title}</AppText>
                {item.ribbon ? (
                  <HStack align="center" gap="xs" style={styles.ribbon}>
                    <Icon as={Star} size="xs" tint={colors.brandAccent} />
                    <AppText variant="micro" style={styles.brand}>
                      {item.ribbon}
                    </AppText>
                  </HStack>
                ) : null}
                {item.description ? (
                  <AppText variant="caption" color="textSecondary">
                    {item.description}
                  </AppText>
                ) : null}

                {facts.map(fact => (
                  <HStack key={fact.label} gap="sm" align="start">
                    <Icon as={fact.icon} size="sm" color="textSecondary" />
                    <VStack flex={1}>
                      <AppText variant="caption">{fact.label}</AppText>
                      <AppText variant="caption" color="textSecondary">
                        {fact.value}
                      </AppText>
                    </VStack>
                  </HStack>
                ))}

                <VStack gap="xxs">
                  <AppText variant="bodyStrong">Price</AppText>
                  {mode === 'coins' ? (
                    <HStack align="baseline" gap="xxs" wrap>
                      <CoinAmount
                        amount={item.coinPrice}
                        size="lg"
                        tint={colors.brandAccent}
                      />
                      <AppText
                        variant="micro"
                        style={[styles.brand, styles.unit]}
                      >
                        coins
                      </AppText>
                    </HStack>
                  ) : (
                    <HStack align="baseline" gap="xs" wrap>
                      <AppText variant="h1" style={styles.brand}>
                        {formatMoney(item.price, item.currency)}
                      </AppText>
                      {item.mrp !== null && item.mrp > item.price ? (
                        <AppText
                          variant="caption"
                          color="textTertiary"
                          style={styles.struck}
                        >
                          {formatMoney(item.mrp, item.currency)}
                        </AppText>
                      ) : null}
                    </HStack>
                  )}
                  {mode === 'mixed' && item.coinsMax > 0 ? (
                    <HStack align="center" gap="xxs" wrap>
                      <AppText variant="micro" color="textSecondary">
                        {item.coinsMin === 0
                          ? 'Use up to'
                          : item.coinsMin >= item.coinsMax
                          ? 'Takes'
                          : `Use ${formatCoins(item.coinsMin)} to`}
                      </AppText>
                      <CoinAmount
                        amount={item.coinsMax}
                        size="sm"
                        tint={colors.brandAccent}
                        withUnit
                      />
                    </HStack>
                  ) : null}
                  {!item.inStock ? (
                    <AppText variant="micro" color="warning">
                      Sold out — save it to hear when it is back
                    </AppText>
                  ) : null}
                </VStack>
              </VStack>
            </HStack>

            {item.colors.length > 0 ? (
              <VStack gap="md">
                <HStack align="center" justify="between">
                  <AppText variant="h3">Select Color</AppText>
                  {color ? (
                    <AppText variant="micro" color="textTertiary">
                      {color}
                    </AppText>
                  ) : null}
                </HStack>
                <ColorSwatchPicker
                  colors={item.colors}
                  value={color}
                  onChange={setColor}
                />
              </VStack>
            ) : null}

            {item.sizes.length > 0 ? (
              <VStack gap="md">
                <HStack align="center" justify="between">
                  <AppText variant="h3">Select Size</AppText>
                  {size ? (
                    <AppText variant="micro" color="textTertiary">
                      {size}
                    </AppText>
                  ) : null}
                </HStack>
                <SizePicker
                  sizes={item.sizes}
                  value={size}
                  onChange={onChangeSize}
                  error={sizeError}
                  showLabel={false}
                />
              </VStack>
            ) : null}

            {item.features.length > 0 ? (
              <VStack gap="md">
                <AppText variant="h3">Key Features</AppText>
                <ProductFeatureGrid features={item.features} />
              </VStack>
            ) : null}

            {infoRows.length > 0 ? (
              <VStack gap="md">
                <AppText variant="h3">Product Information</AppText>
                <ProductInfoCard rows={infoRows} />
              </VStack>
            ) : null}
          </>
        )}
      </ScrollView>

      {item ? (
        <View
          style={[
            styles.bar,
            { paddingBottom: Math.max(insets.bottom, spacing.base) },
          ]}
        >
          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong">You Pay</AppText>
            {quote ? (
              <PayAmount quote={quote} size="lg" />
            ) : mode === 'coins' ? (
              <CoinAmount
                amount={item.coinPrice}
                size="lg"
                tint={colors.brandAccent}
                withUnit
              />
            ) : (
              <AppText variant="h2" style={styles.brand}>
                {formatMoney(item.price, item.currency)}
              </AppText>
            )}
            {quote && quote.coinsShort > 0 ? (
              <AppText variant="micro" color="warning">
                {`You need ${formatCoins(quote.coinsShort)} more coins`}
              </AppText>
            ) : quote && quote.shipping > 0 ? (
              <AppText variant="micro" color="textTertiary">
                {quote.inCoins
                  ? `incl. ${formatCoins(
                      quote.inCoins.shipping,
                    )} coins delivery`
                  : `incl. ${formatMoney(
                      quote.shipping,
                      quote.currency,
                    )} delivery`}
              </AppText>
            ) : null}
          </VStack>

          <VStack flex={1} gap="xs">
            <Button
              label={
                !item.inStock
                  ? 'Sold out'
                  : short
                  ? 'Not enough coins'
                  : 'Redeem Now'
              }
              variant="brand"
              fullWidth
              disabled={!item.inStock || short}
              onPress={onRedeem}
            />
            <HStack align="center" justify="center" gap="xxs">
              <Icon as={CircleCheck} size="xs" color="success" />
              <AppText variant="micro" color="success">
                {mode === 'money'
                  ? '100% Secure Checkout'
                  : '100% Secure Redemption'}
              </AppText>
            </HStack>
          </VStack>
        </View>
      ) : null}
    </Screen>
  );
};
