import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ChevronLeft,
  ChevronRight,
  PackageCheck,
  ShoppingCart,
  Truck,
} from 'lucide-react-native';
import { Pressable } from '../../components/form/Pressable';
import { Box } from '../../components/layout/Box';
import { Divider } from '../../components/layout/Divider';
import { HStack, VStack } from '../../components/layout/Stack';
import { Emoji } from '../../components/media/Emoji';
import { Icon } from '../../components/media/Icon';
import { presentationOf } from '../../components/shop/categories';
import { Price } from '../../components/shop/Price';
import { QuantityStepper } from '../../components/shop/QuantityStepper';
import { RatingStars } from '../../components/shop/RatingStars';
import { ReviewCard } from '../../components/shop/ReviewCard';
import { ShopItemBadge } from '../../components/shop/ShopItemBadge';
import { SizePicker } from '../../components/shop/SizePicker';
import { WishlistButton } from '../../components/shop/WishlistButton';
import { useAddToCart } from '../../components/shop/useAddToCart';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconButton } from '../../components/ui/IconButton';
import { Screen } from '../../components/ui/Screen';
import { CoinAmount } from '../../components/wallet/CoinAmount';
import { useReviews } from '../../hooks/useReviews';
import { shopApi } from '../../services/api/endpoints';
import { useCartCount } from '../../stores/cartStore';
import { useCoinBalance } from '../../stores/coinsStore';
import {
  useShopConfig,
  useShopItem,
  useShopStore,
} from '../../stores/shopStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { Review, ShopItem } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';
import { formatCoins, formatMoney } from '../../utils/format';

const makeStyles = ({ spacing, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl * 2, gap: spacing.base },
    header: { paddingTop: spacing.sm },
    art: {
      height: moderateScale(220),
      alignItems: 'center',
      justifyContent: 'center',
    },
    badge: { position: 'absolute', top: spacing.md, left: spacing.md },
    soldOut: { opacity: 0.5 },
    /** The buttons sit over the scroll, so the last content pads past them. */
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
      flexDirection: 'row',
      gap: spacing.sm,
    },
    grow: { flex: 1 },
    empty: { paddingVertical: spacing.xl },
    histogramBar: { height: 6, borderRadius: 3, flex: 1 },
  });

/** How many reviews the page shows before "See all". */
const REVIEW_PREVIEW = 3;

/**
 * One item in full: what it is, what it costs in money and in coins, its
 * sizes, how many, what people thought, and the two ways to buy it.
 *
 * The page reads the shelf's copy of the item at once and asks the server
 * for a fresh one on arrival — stock and rating are the two things about
 * an item that change by the hour, and a deep link lands here with no
 * copy at all. "Add to cart" leaves the user here to keep browsing; "Buy
 * now" takes exactly this line to the till and leaves the basket as it
 * was.
 */
export const ProductDetailScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'ProductDetail'>['route']>();
  const { id } = route.params;

  const cached = useShopItem(id);
  const upsertItem = useShopStore(s => s.upsertItem);
  const config = useShopConfig();
  const balance = useCoinBalance();
  const cartCount = useCartCount();
  const addToCart = useAddToCart();

  const [fetched, setFetched] = useState<ShopItem | null>(null);
  const [isLoading, setLoading] = useState(cached === null);
  const item = fetched ?? cached;

  const [size, setSize] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  const reviews = useReviews(id, 'recent', REVIEW_PREVIEW);

  // Fresh stock and rating, and the whole item for a deep link.
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

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Shop' });
  }, [navigation]);
  const onPressCart = useCallback(
    () => navigation.navigate('Cart'),
    [navigation],
  );
  const onPressReviews = useCallback(
    () => navigation.navigate('Reviews', { itemId: id }),
    [id, navigation],
  );
  const onWriteReview = useCallback(
    () => navigation.navigate('WriteReview', { itemId: id }),
    [id, navigation],
  );
  const onEditReview = useCallback(
    (_review: Review) => navigation.navigate('WriteReview', { itemId: id }),
    [id, navigation],
  );

  const onChangeSize = useCallback((value: string) => {
    setSize(value);
    setSizeError(null);
  }, []);

  /** A sized item with no size picked is stopped here, with the reason under the sizes. */
  const requireSize = useCallback(() => {
    if (item && item.sizes.length > 0 && !size) {
      setSizeError('Pick a size first.');
      return false;
    }
    return true;
  }, [item, size]);

  const onAddToCart = useCallback(() => {
    if (!item || !requireSize()) return;
    addToCart(item, size, quantity);
  }, [addToCart, item, quantity, requireSize, size]);

  const onBuyNow = useCallback(() => {
    if (!item || !requireSize()) return;
    navigation.navigate('Checkout', {
      lines: [{ itemId: item.id, quantity, size }],
    });
  }, [item, navigation, quantity, requireSize, size]);

  // Both lines wait for the till's rules: a split or a delivery promise
  // drawn from rules the app made up could disagree with the checkout.
  const coinsLine = useMemo(() => {
    if (!item || item.coinsMax === 0 || config === null) return null;
    const coins = Math.min(item.coinsMax * quantity, Math.floor(balance));
    const worth = coins * config.coinValuePaise;
    return { coins, worth, capped: coins < item.coinsMax * quantity };
  }, [balance, config, item, quantity]);

  const deliveryLine = useMemo(() => {
    if (config === null) return null;
    if (config.freeShippingAbovePaise === null) {
      return config.shippingFeePaise === 0
        ? 'Free delivery'
        : `Delivery ${formatMoney(config.shippingFeePaise, config.currency)}`;
    }
    if (config.shippingFeePaise === 0) return 'Free delivery';
    return `Free delivery on orders over ${formatMoney(
      config.freeShippingAbovePaise,
      config.currency,
    )} · ${formatMoney(config.shippingFeePaise, config.currency)} otherwise`;
  }, [config]);

  const presentation = item ? presentationOf(item.category) : null;

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <HStack align="center" justify="between" style={styles.header}>
          <Pressable
            onPress={onPressBack}
            feedback="opacity"
            visualSize={24}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Icon as={ChevronLeft} size="lg" color="text" />
          </Pressable>
          <HStack align="center" gap="md">
            {item ? <WishlistButton item={item} size="md" /> : null}
            <IconButton
              icon={ShoppingCart}
              onPress={onPressCart}
              badge={cartCount}
              accessibilityLabel={
                cartCount > 0 ? `Cart, ${cartCount} items` : 'Cart'
              }
            />
          </HStack>
        </HStack>

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
            <View>
              <Box
                bg="muted"
                radius="xxl"
                style={[styles.art, !item.inStock && styles.soldOut]}
              >
                <Emoji size={moderateScale(96)} label={item.title}>
                  {item.emoji}
                </Emoji>
              </Box>
              {item.badge ? (
                <View style={styles.badge}>
                  <ShopItemBadge badge={item.badge} />
                </View>
              ) : null}
            </View>

            <VStack gap="sm">
              <AppText variant="label" color="textTertiary">
                {[presentation?.label, item.subcategory]
                  .filter(Boolean)
                  .join(' · ')}
              </AppText>
              <AppText variant="h2">{item.title}</AppText>
              <Pressable
                onPress={onPressReviews}
                feedback="opacity"
                accessibilityRole="button"
                accessibilityLabel={
                  item.rating.count > 0
                    ? `Rated ${item.rating.average.toFixed(1)}, ${
                        item.rating.count
                      } reviews, see all`
                    : 'No reviews yet, be the first'
                }
              >
                <HStack align="center" gap="xs">
                  <RatingStars
                    value={item.rating.average}
                    size="sm"
                    count={item.rating.count}
                  />
                  <AppText variant="micro" color="primary">
                    {item.rating.count > 0
                      ? 'See reviews'
                      : 'Be the first to review'}
                  </AppText>
                </HStack>
              </Pressable>
              <Price
                price={item.price}
                mrp={item.mrp}
                currency={item.currency}
                size="lg"
              />
              {coinsLine ? (
                <HStack align="center" gap="xs" wrap>
                  <AppText variant="caption" color="textSecondary">
                    Pay up to
                  </AppText>
                  <CoinAmount amount={coinsLine.coins} size="sm" />
                  <AppText variant="caption" color="textSecondary">
                    {`with coins (${formatMoney(
                      coinsLine.worth,
                      item.currency,
                    )} off)${
                      coinsLine.capped
                        ? ` · you have ${formatCoins(Math.floor(balance))}`
                        : ''
                    }`}
                  </AppText>
                </HStack>
              ) : null}
            </VStack>

            {item.sizes.length > 0 ? (
              <SizePicker
                sizes={item.sizes}
                value={size}
                onChange={onChangeSize}
                error={sizeError}
              />
            ) : null}

            <HStack align="center" justify="between">
              <AppText variant="label" color="textSecondary">
                Quantity
              </AppText>
              <QuantityStepper
                value={quantity}
                max={config?.maxQuantityPerLine ?? quantity}
                onChange={setQuantity}
                label={item.title}
              />
            </HStack>

            <Card radius="xl" padding="base">
              <VStack gap="sm">
                <AppText variant="label" color="textSecondary">
                  About
                </AppText>
                <AppText variant="body">{item.description}</AppText>
                <Divider />
                {deliveryLine ? (
                  <HStack align="center" gap="sm">
                    <Icon as={Truck} size="sm" tint={colors.primary} />
                    <AppText variant="caption" color="textSecondary">
                      {deliveryLine}
                    </AppText>
                  </HStack>
                ) : null}
                <HStack align="center" gap="sm">
                  <Icon
                    as={PackageCheck}
                    size="sm"
                    tint={item.inStock ? colors.success : colors.warning}
                  />
                  <AppText variant="caption" color="textSecondary">
                    {item.inStock
                      ? 'In stock — ships in 2–4 days'
                      : 'Sold out — save it to be told when it is back'}
                  </AppText>
                </HStack>
              </VStack>
            </Card>

            <VStack gap="md">
              <HStack align="center" justify="between">
                <AppText variant="h3">Reviews</AppText>
                {reviews.summary && reviews.summary.count > REVIEW_PREVIEW ? (
                  <Pressable
                    onPress={onPressReviews}
                    feedback="opacity"
                    accessibilityRole="button"
                    accessibilityLabel={`See all ${reviews.summary.count} reviews`}
                  >
                    <HStack align="center" gap="xxs">
                      <AppText variant="micro" color="primary">
                        {`See all ${reviews.summary.count}`}
                      </AppText>
                      <Icon as={ChevronRight} size="xs" color="primary" />
                    </HStack>
                  </Pressable>
                ) : null}
              </HStack>

              {reviews.summary && reviews.summary.count > 0 ? (
                <Card radius="xl" padding="base">
                  <HStack align="center" gap="lg">
                    <VStack align="center" gap="xxs">
                      <AppText variant="metric">
                        {reviews.summary.average.toFixed(1)}
                      </AppText>
                      <RatingStars value={reviews.summary.average} size="xs" />
                      <AppText variant="micro" color="textTertiary">
                        {`${reviews.summary.count} ${
                          reviews.summary.count === 1 ? 'review' : 'reviews'
                        }`}
                      </AppText>
                    </VStack>
                    <VStack gap="xxs" flex={1}>
                      {[5, 4, 3, 2, 1].map(star => {
                        const n = reviews.summary!.histogram[star - 1];
                        const share =
                          reviews.summary!.count === 0
                            ? 0
                            : n / reviews.summary!.count;
                        return (
                          <HStack key={star} align="center" gap="sm">
                            <AppText
                              variant="micro"
                              color="textSecondary"
                            >{`${star}★`}</AppText>
                            <View
                              style={[
                                styles.histogramBar,
                                { backgroundColor: colors.muted },
                              ]}
                            >
                              <View
                                style={[
                                  styles.histogramBar,
                                  {
                                    backgroundColor: colors.gold,
                                    flex: undefined,
                                    width: `${Math.round(share * 100)}%`,
                                  },
                                ]}
                              />
                            </View>
                            <AppText variant="micro" color="textTertiary">
                              {String(n)}
                            </AppText>
                          </HStack>
                        );
                      })}
                    </VStack>
                  </HStack>
                </Card>
              ) : null}

              {reviews.reviews.map(review => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  onEdit={onEditReview}
                />
              ))}

              {reviews.error ? (
                <AppText variant="caption" color="textSecondary" center>
                  {reviews.error}
                </AppText>
              ) : null}

              <Button
                label={reviews.mine ? 'Edit your review' : 'Write a review'}
                variant="secondary"
                onPress={onWriteReview}
                fullWidth
              />
            </VStack>
          </>
        )}
      </ScrollView>

      {item ? (
        <View style={styles.bar}>
          <View style={styles.grow}>
            <Button
              label="Add to cart"
              variant="secondary"
              fullWidth
              disabled={!item.inStock}
              onPress={onAddToCart}
            />
          </View>
          <View style={styles.grow}>
            <Button
              label={item.inStock ? 'Buy now' : 'Sold out'}
              variant="brand"
              fullWidth
              disabled={!item.inStock}
              onPress={onBuyNow}
            />
          </View>
        </View>
      ) : null}
    </Screen>
  );
};
