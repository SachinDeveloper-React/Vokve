import React, { Fragment, useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronDown, Trophy } from 'lucide-react-native';
import { PageHeader } from '../../components/layout/PageHeader';
import { Divider } from '../../components/layout/Divider';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { Pressable } from '../../components/form/Pressable';
import { LeaderboardEntryRow } from '../../components/leaderboard/LeaderboardEntryRow';
import { MyPlaceCard } from '../../components/leaderboard/MyPlaceCard';
import { AppText } from '../../components/ui/AppText';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useLeaderboardBoard } from '../../hooks/useLeaderboard';
import { syncStepsNow } from '../../services/steps';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { formatDateRange } from '../../utils/date';
import { formatGrouped } from '../../utils/format';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * This week's board in full.
 *
 * What the rewards screen's "View Full Leaderboard" leads to. That card shows
 * five places because it sits under a prize table it is illustrating; this is
 * the board itself, every place the server serves.
 *
 * The reader's own place is stated at the top as well as left in the list.
 * The two are not a duplicate: the card answers "how am I doing", the row
 * answers "who is around me", and a member in the eighties would have to
 * scroll past everyone ahead of them to get the first answer from the second.
 *
 * It pages. The board itself is the top ⚙ `leaderboard.boardSize` places —
 * ranking a whole country would be a list nobody scrolls, and every place
 * that pays is inside it — so this asks for a page at a time and says how
 * many are ranked beyond what it holds rather than pretending the list is
 * everyone. "Show more" asks for the next page; the server clips the request
 * to the board, so the button runs out exactly where the board does.
 */
/** How many places one page of the board holds. */
const PAGE = 20;

export const LeaderboardBoardScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  // Pages are asked for by growing the number of places wanted, so the list
  // on screen is always one answer rather than several stitched together —
  // which is what keeps a refresh from showing two different weeks at once.
  const [pages, setPages] = useState(1);
  const board = useLeaderboardBoard(PAGE * pages);
  const showMore = useCallback(() => setPages(current => current + 1), []);

  const [refreshing, setRefreshing] = useState(false);
  const { reload } = board;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncStepsNow();
    } finally {
      reload();
      setRefreshing(false);
    }
  }, [reload]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('LeaderboardRewards');
  }, [navigation]);

  const entries = board.data?.entries ?? [];
  const ranked = board.data?.ranked ?? 0;
  const beyond = Math.max(0, ranked - entries.length);

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
          title="Leaderboard"
          subtitle={
            board.data
              ? formatDateRange(board.data.period.start, board.data.period.end)
              : undefined
          }
          onPressBack={onPressBack}
        />

        {board.data === null ? (
          <LoadState
            loading={board.loading}
            title="Couldn't load the board"
            message={board.error}
            onRetry={board.reload}
          />
        ) : (
          <>
            <MyPlaceCard me={board.data.me} ranked={ranked} />

            <Card radius="xl" padding="base">
              <VStack gap="sm">
                <HStack align="center" justify="between" gap="sm">
                  <AppText variant="h3">This Week</AppText>
                  <AppText variant="micro" color="textSecondary">
                    {`${formatGrouped(ranked)} ranked`}
                  </AppText>
                </HStack>

                {entries.length === 0 ? (
                  <EmptyState
                    title="Nobody has scored yet"
                    message="The week has just started. Walk, train or finish a challenge to take the first place."
                    icon={<Icon as={Trophy} size="xl" color="textTertiary" />}
                  />
                ) : (
                  <VStack>
                    {entries.map((entry, index) => (
                      <Fragment key={entry.id}>
                        {index > 0 ? <Divider /> : null}
                        <LeaderboardEntryRow entry={entry} />
                      </Fragment>
                    ))}
                  </VStack>
                )}

                {board.data.hasMore ? (
                  <Pressable
                    onPress={showMore}
                    feedback="opacity"
                    accessibilityRole="button"
                    accessibilityLabel="Show more places"
                  >
                    <HStack align="center" justify="center" gap="xs" py="sm">
                      <AppText
                        variant="micro"
                        style={{ color: colors.primary }}
                      >
                        {board.loading ? 'Loading…' : 'Show more'}
                      </AppText>
                      <Icon as={ChevronDown} size="xs" tint={colors.primary} />
                    </HStack>
                  </Pressable>
                ) : null}

                {beyond > 0 ? (
                  <AppText variant="micro" color="textTertiary" center>
                    {`${formatGrouped(
                      beyond,
                    )} more ranked below the places shown`}
                  </AppText>
                ) : null}
              </VStack>
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
};
