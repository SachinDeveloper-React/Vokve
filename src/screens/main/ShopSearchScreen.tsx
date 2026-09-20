import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, History, Search, X } from 'lucide-react-native';
import { Pressable } from '../../components/form/Pressable';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { SHOP_CATEGORIES } from '../../components/shop/categories';
import { ShopCategoryChip } from '../../components/shop/ShopCategoryChip';
import { ShopItemCard } from '../../components/shop/ShopItemCard';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { useCatalogue } from '../../hooks/useCatalogue';
import {
  useRecentShopSearches,
  useShopSearchStore,
} from '../../stores/shopSearchStore';
import {
  radius,
  typography,
  useTheme,
  useThemedStyles,
  type ThemeShape,
} from '../../theme';
import type { ShopCategory, ShopItem } from '../../types/models';

const makeStyles = ({ spacing, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl },
    header: {
      gap: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    field: {
      flex: 1,
      minHeight: 48,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    input: {
      flex: 1,
      ...typography.body,
      color: colors.text,
      paddingVertical: 0,
    },
    chips: { gap: spacing.xs },
    cell: { flex: 1, padding: spacing.xs },
    footer: {
      paddingVertical: spacing.lg,
      alignItems: 'center',
      gap: spacing.sm,
    },
    empty: { paddingVertical: spacing.xl },
    recentRow: { paddingVertical: spacing.sm },
  });

/** How long the field stays still before its text becomes a request. */
const DEBOUNCE_MS = 250;
/** Shorter than this and the server would match half the shop. */
const MIN_QUERY_LENGTH = 2;

/**
 * Search across the whole catalogue — or one shelf of it.
 *
 * The field is live: the text becomes a request a quarter of a second after
 * the last keystroke, which is fast enough to feel like filtering and slow
 * enough not to send "s", "sh", "sho" as three requests. Anything the user
 * has searched before is offered back while the field is empty; a category
 * chip narrows the same search without retyping it.
 *
 * A result is bought the way anything in the shop is bought: the same hook
 * and sheets, so a search never has its own idea of what a spend looks like.
 */
export const ShopSearchScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const recent = useRecentShopSearches();
  const remember = useShopSearchStore(s => s.remember);
  const forget = useShopSearchStore(s => s.forget);

  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ShopCategory | null>(null);
  const field = useRef<React.ComponentRef<typeof TextInput>>(null);

  // The debounce: the request follows the field, a beat behind.
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setQuery('');
      return undefined;
    }
    const timer = setTimeout(() => setQuery(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  // A search that ran is worth offering back — once its results have landed.
  const searchQuery = useMemo(
    () => ({ q: query || undefined, category: category ?? undefined }),
    [category, query],
  );
  const isSearching = query.length >= MIN_QUERY_LENGTH;
  const catalogue = useCatalogue(searchQuery, isSearching);
  useEffect(() => {
    if (isSearching && !catalogue.isLoading && catalogue.total !== null) {
      remember(query);
    }
  }, [catalogue.isLoading, catalogue.total, isSearching, query, remember]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Shop' });
  }, [navigation]);

  const clearText = useCallback(() => {
    setText('');
    field.current?.focus();
  }, []);
  const searchAgain = useCallback((term: string) => setText(term), []);
  const onOpenItem = useCallback(
    (item: ShopItem) => navigation.navigate('ProductDetail', { id: item.id }),
    [navigation],
  );
  const toggleCategory = useCallback(
    (value: ShopCategory) =>
      setCategory(current => (current === value ? null : value)),
    [],
  );

  const renderItem = useCallback<ListRenderItem<ShopItem>>(
    ({ item }) => (
      <View style={styles.cell}>
        <ShopItemCard item={item} onPress={onOpenItem} fill />
      </View>
    ),
    [onOpenItem, styles.cell],
  );
  const keyExtractor = useCallback((item: ShopItem) => item.id, []);

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <HStack align="center" gap="sm">
          <Pressable
            onPress={onPressBack}
            feedback="opacity"
            visualSize={24}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Icon as={ChevronLeft} size="lg" color="text" />
          </Pressable>

          <HStack align="center" gap="sm" px="md" style={styles.field}>
            <Icon as={Search} size="md" color="textTertiary" />
            <TextInput
              ref={field}
              value={text}
              onChangeText={setText}
              placeholder="Search tees, mats, rackets…"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="never"
              accessibilityLabel="Search the shop"
            />
            {text.length > 0 ? (
              <Pressable
                onPress={clearText}
                feedback="opacity"
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Icon as={X} size="sm" color="textTertiary" />
              </Pressable>
            ) : null}
          </HStack>
        </HStack>

        <HStack align="center" gap="xs" wrap style={styles.chips}>
          {SHOP_CATEGORIES.map(entry => (
            <ShopCategoryChip
              key={entry.value}
              value={entry.value}
              label={entry.label}
              icon={entry.icon}
              tint={colors[entry.tint]}
              selected={category === entry.value}
              onPress={toggleCategory}
            />
          ))}
        </HStack>

        {isSearching && catalogue.total !== null ? (
          <AppText variant="caption" color="textSecondary">
            {`${catalogue.total} ${
              catalogue.total === 1 ? 'result' : 'results'
            } for "${query}"`}
          </AppText>
        ) : null}
      </View>
    ),
    [
      catalogue.total,
      category,
      clearText,
      colors,
      isSearching,
      onPressBack,
      query,
      styles.chips,
      styles.field,
      styles.header,
      styles.input,
      text,
      toggleCategory,
    ],
  );

  /**
   * With nothing typed: the searches before, or a hint. With a query that
   * found nothing: say so in its words, so a user does not re-run it.
   */
  const empty = useMemo(() => {
    if (!isSearching) {
      if (recent.length === 0) {
        return (
          <Card radius="xl" style={styles.empty}>
            <EmptyState
              title="What are you after?"
              message="Try a thing — shorts, rope, racket — or a word from its description."
            />
          </Card>
        );
      }
      return (
        <Card radius="xl" padding="base">
          <VStack gap="xs">
            <AppText variant="label" color="textSecondary">
              Recent searches
            </AppText>
            {recent.map(term => (
              <HStack
                key={term}
                align="center"
                justify="between"
                style={styles.recentRow}
              >
                <Pressable
                  onPress={() => searchAgain(term)}
                  feedback="opacity"
                  accessibilityRole="button"
                  accessibilityLabel={`Search again for ${term}`}
                >
                  <HStack align="center" gap="sm">
                    <Icon as={History} size="sm" color="textTertiary" />
                    <AppText variant="body">{term}</AppText>
                  </HStack>
                </Pressable>
                <Pressable
                  onPress={() => forget(term)}
                  feedback="opacity"
                  accessibilityRole="button"
                  accessibilityLabel={`Forget ${term}`}
                >
                  <Icon as={X} size="sm" color="textTertiary" />
                </Pressable>
              </HStack>
            ))}
          </VStack>
        </Card>
      );
    }
    if (catalogue.isLoading) {
      return (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (catalogue.error) {
      return (
        <Card radius="xl" style={styles.empty}>
          <EmptyState
            title="Couldn't search right now"
            message={catalogue.error}
            actionLabel="Try again"
            onAction={catalogue.retry}
          />
        </Card>
      );
    }
    return (
      <Card radius="xl" style={styles.empty}>
        <EmptyState
          title={`Nothing for "${query}"`}
          message={
            category
              ? 'Try clearing the category, or another word for it.'
              : 'Try another word for it — a mat is also "yoga", a tee is also "shirt".'
          }
        />
      </Card>
    );
  }, [
    catalogue.error,
    catalogue.isLoading,
    catalogue.retry,
    category,
    colors.primary,
    forget,
    isSearching,
    query,
    recent,
    searchAgain,
    styles.empty,
    styles.recentRow,
  ]);

  const footer = useMemo(() => {
    if (catalogue.isLoadingMore) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (catalogue.error && catalogue.items.length > 0) {
      return (
        <VStack style={styles.footer}>
          <AppText variant="caption" color="textSecondary" center>
            {catalogue.error}
          </AppText>
          <Button
            label="Try again"
            variant="secondary"
            size="sm"
            onPress={catalogue.retry}
          />
        </VStack>
      );
    }
    return null;
  }, [
    catalogue.error,
    catalogue.isLoadingMore,
    catalogue.items.length,
    catalogue.retry,
    colors.primary,
    styles.footer,
  ]);

  return (
    <Screen edges={['top']}>
      <FlashList
        data={isSearching ? catalogue.items : []}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={2}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={isSearching ? footer : null}
        onEndReached={isSearching ? catalogue.loadMore : undefined}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
};
