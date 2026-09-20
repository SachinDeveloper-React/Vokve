import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { useNavigation, useRoute } from '@react-navigation/native';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { Pressable } from '../../components/form/Pressable';
import { HStack, VStack } from '../../components/layout/Stack';
import { RatingStars } from '../../components/shop/RatingStars';
import { ReviewCard } from '../../components/shop/ReviewCard';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useReviews } from '../../hooks/useReviews';
import type { ReviewSort } from '../../services/api/contracts';
import { useCoinBalance } from '../../stores/coinsStore';
import { useShopItem } from '../../stores/shopStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { Review } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl },
    header: { gap: spacing.md, paddingBottom: spacing.md },
    row: { paddingBottom: spacing.sm },
    footer: {
      paddingVertical: spacing.lg,
      alignItems: 'center',
      gap: spacing.sm,
    },
    empty: { paddingVertical: spacing.xl },
    selectedSort: { fontWeight: '700' },
  });

const SORTS: readonly { value: ReviewSort; label: string }[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'top', label: 'Highest rated' },
];

/**
 * Every review of an item, paged, under the summary — and the way to add
 * the reader's own, or change it.
 */
export const ReviewsScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'Reviews'>['route']>();
  const { itemId } = route.params;
  const balance = useCoinBalance();
  const item = useShopItem(itemId);
  const [sort, setSort] = useState<ReviewSort>('recent');
  const reviews = useReviews(itemId, sort);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('ProductDetail', { id: itemId });
  }, [itemId, navigation]);
  const onWrite = useCallback(
    () => navigation.navigate('WriteReview', { itemId }),
    [itemId, navigation],
  );
  const onEdit = useCallback((_review: Review) => onWrite(), [onWrite]);

  const renderItem = useCallback<ListRenderItem<Review>>(
    ({ item: review }) => (
      <View style={styles.row}>
        <ReviewCard review={review} onEdit={onEdit} />
      </View>
    ),
    [onEdit, styles.row],
  );
  const keyExtractor = useCallback((review: Review) => review.id, []);

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title="Reviews"
          subtitle={item?.title ?? ' '}
        />
        {reviews.summary ? (
          <Card radius="xl" padding="base">
            <HStack align="center" justify="between" gap="md">
              <VStack gap="xxs">
                <HStack align="baseline" gap="xs">
                  <AppText variant="h1">
                    {reviews.summary.average.toFixed(1)}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    out of 5
                  </AppText>
                </HStack>
                <RatingStars value={reviews.summary.average} size="sm" />
                <AppText variant="micro" color="textTertiary">
                  {`${reviews.summary.count} ${
                    reviews.summary.count === 1 ? 'review' : 'reviews'
                  }`}
                </AppText>
              </VStack>
              <Button
                label={reviews.mine ? 'Edit yours' : 'Write a review'}
                variant="brand"
                size="sm"
                onPress={onWrite}
              />
            </HStack>
          </Card>
        ) : null}
        <HStack gap="sm">
          {SORTS.map(entry => (
            <Pressable
              key={entry.value}
              onPress={() => setSort(entry.value)}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityState={{ selected: sort === entry.value }}
              accessibilityLabel={entry.label}
            >
              <AppText
                variant="micro"
                color={sort === entry.value ? 'primary' : 'textSecondary'}
                style={sort === entry.value ? styles.selectedSort : undefined}
              >
                {entry.label}
              </AppText>
            </Pressable>
          ))}
        </HStack>
      </View>
    ),
    [
      balance,
      item?.title,
      onPressBack,
      onWrite,
      reviews.mine,
      reviews.summary,
      sort,
      styles.header,
      styles.selectedSort,
    ],
  );

  const empty = useMemo(() => {
    if (reviews.isLoading) {
      return (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (reviews.error) {
      return (
        <Card radius="xl" style={styles.empty}>
          <EmptyState
            title="Couldn't load reviews"
            message={reviews.error}
            actionLabel="Try again"
            onAction={reviews.retry}
          />
        </Card>
      );
    }
    return (
      <Card radius="xl" style={styles.empty}>
        <EmptyState
          title="No reviews yet"
          message="Bought it? Say what you thought — the next person is deciding."
          actionLabel="Write the first review"
          onAction={onWrite}
        />
      </Card>
    );
  }, [
    colors.primary,
    onWrite,
    reviews.error,
    reviews.isLoading,
    reviews.retry,
    styles.empty,
  ]);

  const footer = useMemo(() => {
    if (reviews.isLoadingMore) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (reviews.error && reviews.reviews.length > 0) {
      return (
        <VStack style={styles.footer}>
          <AppText variant="caption" color="textSecondary" center>
            {reviews.error}
          </AppText>
          <Button
            label="Try again"
            variant="secondary"
            size="sm"
            onPress={reviews.retry}
          />
        </VStack>
      );
    }
    return null;
  }, [
    colors.primary,
    reviews.error,
    reviews.isLoadingMore,
    reviews.retry,
    reviews.reviews.length,
    styles.footer,
  ]);

  return (
    <Screen edges={['top']}>
      <FlashList
        data={reviews.reviews}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={reviews.loadMore}
        onEndReachedThreshold={0.4}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
};
