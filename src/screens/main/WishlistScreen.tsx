import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { ShopItemCard } from '../../components/shop/ShopItemCard';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useAuthStatus } from '../../stores/authStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useWishlistItems, useWishlistStore } from '../../stores/wishlistStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { ShopItem } from '../../types/models';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl },
    header: { paddingBottom: spacing.md },
    cell: { flex: 1, padding: spacing.xs },
    empty: { paddingVertical: spacing.xl },
  });

/**
 * What the user has saved, with prices and stock as they are now. The
 * same cards as the shelf, so a saved thing can be added to the basket —
 * or unsaved, from its own heart — without opening it.
 */
export const WishlistScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const balance = useCoinBalance();
  const isSignedIn = useAuthStatus() === 'authenticated';

  const items = useWishlistItems();
  const isLoading = useWishlistStore(s => s.isLoadingItems);
  const loadItems = useWishlistStore(s => s.loadItems);

  useEffect(() => {
    if (isSignedIn) {
      loadItems();
    }
  }, [isSignedIn, loadItems]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Shop' });
  }, [navigation]);
  const onPressItem = useCallback(
    (item: ShopItem) => navigation.navigate('ProductDetail', { id: item.id }),
    [navigation],
  );
  const onPressShop = useCallback(
    () => navigation.navigate('Main', { screen: 'Shop' }),
    [navigation],
  );

  const renderItem = useCallback<ListRenderItem<ShopItem>>(
    ({ item }) => (
      <View style={styles.cell}>
        <ShopItemCard item={item} onPress={onPressItem} fill />
      </View>
    ),
    [onPressItem, styles.cell],
  );
  const keyExtractor = useCallback((item: ShopItem) => item.id, []);

  return (
    <Screen edges={['top']}>
      <FlashList
        data={items ?? []}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={2}
        ListHeaderComponent={
          <View style={styles.header}>
            <HistoryHeader
              coins={balance}
              onPressBack={onPressBack}
              title="Wishlist"
              subtitle={
                items === null
                  ? ' '
                  : `${items.length} ${
                      items.length === 1 ? 'item' : 'items'
                    } saved`
              }
            />
          </View>
        }
        ListEmptyComponent={
          items === null && isLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <Card radius="xl" style={styles.empty}>
              <EmptyState
                title="Nothing saved yet"
                message="Tap the heart on anything in the shop to keep it here for later."
                actionLabel="Browse the shop"
                onAction={onPressShop}
              />
            </Card>
          )
        }
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
};
