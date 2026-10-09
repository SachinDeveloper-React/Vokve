import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Trophy } from 'lucide-react-native';
import { AchievementBadge } from '../../components/challenges/AchievementBadge';
import { AchievementProgressCard } from '../../components/challenges/AchievementProgressCard';
import { Grid } from '../../components/layout/Grid';
import { PageHeader } from '../../components/layout/PageHeader';
import { Icon } from '../../components/media/Icon';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FilterChips, type FilterOption } from '../../components/ui/FilterChips';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useAchievements } from '../../hooks/useChallenges';
import { syncStepsNow } from '../../services/steps';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';

type Shelf = 'all' | 'earned' | 'locked';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    empty: { paddingVertical: spacing.xl },
  });

/**
 * The whole achievement shelf.
 *
 * What the board's "View All" leads to. The board's card pages five at a time
 * through the same badges; this lays them all out at once, which is the only
 * way to see the shape of what is left — four across rather than five, because
 * a full screen has the width the card did not and a cramped ring is harder to
 * tell from its neighbour than a cramped word is.
 *
 * The filter counts both halves rather than only the one it is showing: "7
 * locked" beside "13 earned" is the question the screen exists to answer, and
 * a chip that hid its own total would make the user tap it to find out.
 *
 * Earned first within each view, as on the board. The shelf is a record of
 * what the user has done, and a first row of padlocks reads as a list of
 * failures.
 */
export const AchievementsScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();

  const [shelf, setShelf] = useState<Shelf>('all');
  const achievements = useAchievements();

  const all = useMemo(
    () =>
      [...(achievements.data ?? [])].sort(
        (a, b) => Number(b.achievedAt !== null) - Number(a.achievedAt !== null),
      ),
    [achievements.data],
  );

  const earned = useMemo(() => all.filter(a => a.achievedAt !== null), [all]);
  const locked = useMemo(() => all.filter(a => a.achievedAt === null), [all]);

  const visible =
    shelf === 'earned' ? earned : shelf === 'locked' ? locked : all;

  const shelves = useMemo<readonly FilterOption<Shelf>[]>(
    () => [
      { value: 'all', label: 'All', count: all.length },
      { value: 'earned', label: 'Earned', count: earned.length },
      { value: 'locked', label: 'Locked', count: locked.length },
    ],
    [all.length, earned.length, locked.length],
  );

  const [refreshing, setRefreshing] = useState(false);
  const { reload } = achievements;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncStepsNow();
    } finally {
      reload();
      setRefreshing(false);
    }
  }, [reload]);

  const onOpenAchievement = useCallback(
    (id: string) => navigation.navigate('AchievementDetail', { id }),
    [navigation],
  );

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Challenges');
  }, [navigation]);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <PageHeader
          title="Achievements"
          subtitle="Every badge, and what is left to win"
          onPressBack={onPressBack}
        />

        {achievements.data === null ? (
          <LoadState
            loading={achievements.loading}
            title="Couldn't load your achievements"
            message={achievements.error}
            onRetry={achievements.reload}
          />
        ) : (
          <>
            <AchievementProgressCard achievements={all} />

            <FilterChips options={shelves} value={shelf} onChange={setShelf} />

            <Card radius="xl" padding="base">
              {visible.length === 0 ? (
                <EmptyState
                  title={
                    shelf === 'earned'
                      ? 'No badges yet'
                      : 'Nothing left to unlock'
                  }
                  message={
                    shelf === 'earned'
                      ? 'Finish a challenge or hit a best day and the first one lands here.'
                      : 'You have the whole shelf. New badges arrive with new challenges.'
                  }
                  icon={<Icon as={Trophy} size="xl" color="textTertiary" />}
                />
              ) : (
                <Grid columns={{ compact: 4, expanded: 6 }} gap="base">
                  {visible.map(achievement => (
                    <AchievementBadge
                      key={achievement.id}
                      achievement={achievement}
                      onPress={onOpenAchievement}
                    />
                  ))}
                </Grid>
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
};
