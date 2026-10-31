import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, Plus, Search, X } from 'lucide-react-native';
import {
  CustomFoodSheet,
  type CustomFood,
} from '../../components/meal/CustomFoodSheet';
import { FoodLibraryRow } from '../../components/meal/FoodLibraryRow';
import { useToast } from '../../components/feedback/Toast';
import { Pressable } from '../../components/form/Pressable';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconButton } from '../../components/ui/IconButton';
import { Screen } from '../../components/ui/Screen';
import { useFoodLibrary } from '../../hooks/useFoodLibrary';
import { nutritionApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import { useMealDraftStore } from '../../stores/mealDraftStore';
import {
  radius,
  typography,
  useTheme,
  useThemedStyles,
  type ThemeShape,
} from '../../theme';
import { logger } from '../../utils/logger';
import type { FoodItem } from '../../types/models';

const makeStyles = ({ spacing, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingHorizontal: spacing.base, paddingBottom: spacing.xxxl },
    header: {
      gap: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    field: {
      minHeight: 48,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: spacing.md,
    },
    input: {
      flex: 1,
      ...typography.body,
      color: colors.text,
      paddingVertical: 0,
    },
    row: { paddingBottom: spacing.sm },
    footer: { paddingVertical: spacing.lg, gap: spacing.sm },
    empty: { paddingVertical: spacing.xl },
    bar: {
      paddingHorizontal: spacing.base,
      paddingTop: spacing.md,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      gap: spacing.sm,
    },
  });

/**
 * The whole food library, browsed rather than searched (RULES N8).
 *
 * The Add Meal screen's search answers "I know what I ate"; this answers "show
 * me what there is", which is a different question and needs a different
 * shape: every row the server has, a page at a time (`GET /foods/library`),
 * narrowed by a word when the user wants to narrow it.
 *
 * Foods land on the meal being assembled (`mealDraftStore`), not in the diary.
 * That is what lets a user add six things from here, go back, change the time
 * and the slot, and save once — and what makes Back a way out rather than six
 * corrections to the day's history.
 *
 * The count beside each row is the number of helpings already on the meal, so
 * a user who taps twice can see that they did.
 */
export const FoodLibraryScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [isCustomOpen, setCustomOpen] = useState(false);
  const library = useFoodLibrary(query);

  const foods = useMealDraftStore(s => s.foods);
  const addToMeal = useMealDraftStore(s => s.add);
  const addCustomToMeal = useMealDraftStore(s => s.addCustom);

  /** How many helpings of each food are on the meal, by name and portion. */
  const addedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const food of foods) {
      const key = `${food.name}|${food.portion}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [foods]);

  const onAdd = useCallback(
    (item: FoodItem) => {
      addToMeal(item);
    },
    [addToMeal],
  );

  const openCustom = useCallback(() => setCustomOpen(true), []);
  const closeCustom = useCallback(() => setCustomOpen(false), []);

  /**
   * A food added by hand goes on the meal at once and is sent to the member's
   * own library behind it (`POST /foods/custom`), so the next meal can find it
   * by searching. The meal is what the user asked for, so a library that
   * refuses the row does not cost them the plate — it only says so.
   */
  const onAddCustom = useCallback(
    (food: CustomFood) => {
      addCustomToMeal(food);
      nutritionApi.createCustomFood(food).catch(caught => {
        const error = toApiError(caught);
        logger.warn('FoodLibraryScreen', 'Custom food not saved', error);
        toast.show({
          title: 'Added to this meal only',
          message: `It couldn't be saved to your foods: ${error.message}`,
          tone: 'warning',
        });
      });
    },
    [addCustomToMeal, toast],
  );

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('AddMeal');
  }, [navigation]);

  const clearQuery = useCallback(() => setQuery(''), []);

  const renderItem = useCallback<ListRenderItem<FoodItem>>(
    ({ item }) => (
      <View style={styles.row}>
        <FoodLibraryRow
          item={item}
          added={addedCounts.get(`${item.name}|${item.portion}`) ?? 0}
          onAdd={onAdd}
        />
      </View>
    ),
    [addedCounts, onAdd, styles.row],
  );

  const keyExtractor = useCallback((item: FoodItem) => item.id, []);

  const header = useMemo(
    () => (
      <VStack style={styles.header}>
        <HStack align="center" gap="md">
          <IconButton
            icon={ChevronLeft}
            onPress={onPressBack}
            accessibilityLabel="Back"
          />
          <VStack flex={1} gap="xxs">
            <AppText variant="h2">All Foods</AppText>
            <AppText variant="miniMicro" color="textSecondary">
              {library.total === null
                ? 'The whole library, a page at a time.'
                : `${library.total} ${
                    library.total === 1 ? 'food' : 'foods'
                  } to choose from`}
            </AppText>
          </VStack>
        </HStack>

        <HStack align="center" gap="sm" style={styles.field}>
          <Icon as={Search} size="sm" color="textTertiary" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search foods"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search foods"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={clearQuery}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Icon as={X} size="sm" color="textTertiary" />
            </Pressable>
          ) : null}
        </HStack>
      </VStack>
    ),
    [
      clearQuery,
      colors.textTertiary,
      library.total,
      onPressBack,
      query,
      styles.field,
      styles.header,
      styles.input,
    ],
  );

  const empty = useMemo(() => {
    if (library.isLoading) {
      return (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (library.error !== null) {
      return (
        <Card radius="xl" style={styles.empty}>
          <EmptyState
            title="Couldn't load the foods"
            message={library.error}
            actionLabel="Try again"
            onAction={library.retry}
          />
        </Card>
      );
    }
    return (
      <Card radius="xl" style={styles.empty}>
        <EmptyState
          title={
            query.trim().length > 0
              ? `Nothing for "${query.trim()}"`
              : 'No foods yet'
          }
          message="Add it yourself and it is kept for next time."
          actionLabel="Add a food"
          onAction={openCustom}
        />
      </Card>
    );
  }, [
    colors.primary,
    library.error,
    library.isLoading,
    library.retry,
    openCustom,
    query,
    styles.empty,
  ]);

  const footer = useMemo(() => {
    if (library.isLoadingMore) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (library.error !== null && library.items.length > 0) {
      return (
        <VStack style={styles.footer} gap="sm">
          <AppText variant="caption" color="textSecondary" center>
            {library.error}
          </AppText>
          <Button
            label="Try again"
            variant="secondary"
            size="sm"
            onPress={library.retry}
          />
        </VStack>
      );
    }
    // The scroll loads the next page on its own; the button is for anyone who
    // would rather ask, and for the moment the list is exactly one screen tall
    // and never reaches its own end.
    if (library.hasMore) {
      return (
        <VStack style={styles.footer}>
          <Button
            label="Load more foods"
            variant="secondary"
            size="md"
            fullWidth
            onPress={library.loadMore}
          />
        </VStack>
      );
    }
    if (library.items.length === 0) {
      return null;
    }
    return (
      <VStack style={styles.footer} gap="sm">
        <AppText variant="micro" color="textSecondary" center>
          That's every food here.
        </AppText>
        <Button
          label="Add your own food"
          variant="ghost"
          size="sm"
          fullWidth
          icon={<Icon as={Plus} size="sm" color="text" />}
          onPress={openCustom}
        />
      </VStack>
    );
  }, [
    colors.primary,
    library.error,
    library.hasMore,
    library.isLoadingMore,
    library.items.length,
    library.loadMore,
    library.retry,
    openCustom,
    styles.footer,
  ]);

  return (
    <Screen edges={['top']} padded={false}>
      <FlashList
        data={library.items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={library.loadMore}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      />

      {foods.length > 0 ? (
        <View
          style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 16) }]}
        >
          <HStack align="center" gap="md">
            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong">
                {`${foods.length} ${
                  foods.length === 1 ? 'food' : 'foods'
                } on this meal`}
              </AppText>
              <AppText variant="miniMicro" color="textSecondary">
                Nothing is saved until you save the meal.
              </AppText>
            </VStack>
            <Button label="Done" size="md" onPress={onPressBack} />
          </HStack>
        </View>
      ) : null}

      <CustomFoodSheet
        visible={isCustomOpen}
        initialName={query.trim()}
        onSubmit={onAddCustom}
        onClose={closeCustom}
      />
    </Screen>
  );
};
