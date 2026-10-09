import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { PageHeader } from '../../components/layout/PageHeader';
import { Divider } from '../../components/layout/Divider';
import { VStack } from '../../components/layout/Stack';
import { StreakHistoryRow } from '../../components/streak/StreakHistoryRow';
import { AppText } from '../../components/ui/AppText';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useStreakHistory } from '../../hooks/useStreakHistory';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { StreakHistoryDay } from '../../types/models';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    list: { paddingBottom: spacing.xxxl },
    footer: { paddingVertical: spacing.lg },
  });

/**
 * The streak's whole record, a day at a time.
 *
 * A `FlatList` rather than the `ScrollView` of cards the rest of the streak
 * screen uses: this one grows without bound — a two-year member has seven
 * hundred rows — and is the one list on the streak where recycling earns its
 * keep.
 *
 * Paged from the server rather than fetched whole, and the page carries the
 * missed days as well as the counted ones. A list that only held the days
 * that counted would be a list with the breaks edited out of it, which is
 * exactly what a member comes here to look at.
 */
export const StreakHistoryScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const history = useStreakHistory();

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Streak');
  }, [navigation]);

  const renderItem = useCallback(
    ({ item, index }: { item: StreakHistoryDay; index: number }) => (
      <VStack>
        {index > 0 ? <Divider /> : null}
        <StreakHistoryRow entry={item} />
      </VStack>
    ),
    [],
  );

  const keyExtractor = useCallback((item: StreakHistoryDay) => item.date, []);

  if (history.days.length === 0) {
    return (
      <Screen edges={['top']}>
        <PageHeader
          title="Streak History"
          subtitle="Every day on the record"
          onPressBack={onPressBack}
        />
        {history.isLoading || history.error !== null ? (
          <LoadState
            loading={history.isLoading}
            title="Couldn't load your record"
            message={history.error}
            onRetry={history.refresh}
          />
        ) : (
          <EmptyState
            title="Nothing on the record yet"
            message="Your history starts with the first day that counts."
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <PageHeader
        title="Streak History"
        subtitle={`${history.total} days on the record`}
        onPressBack={onPressBack}
      />

      <FlatList
        data={history.days}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onEndReached={history.loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={history.refresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListFooterComponent={
          history.isLoadingMore ? (
            <ActivityIndicator color={colors.primary} style={styles.footer} />
          ) : history.error !== null ? (
            <AppText variant="micro" color="textSecondary" center>
              {history.error}
            </AppText>
          ) : (
            <VStack />
          )
        }
      />
    </Screen>
  );
};
