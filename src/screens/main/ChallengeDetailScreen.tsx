import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ArrowRight } from 'lucide-react-native';
import {
  ChallengeDetailHero,
  ChallengeDetailTabs,
  ChallengeParticipantsCard,
  ChallengeProgressCard,
  ChallengeRewardCard,
  ChallengeRulesCard,
  ChallengeStandingsCard,
  TopParticipantsCard,
  type ChallengeDetailTab,
} from '../../components/challenges';
import { Icon } from '../../components/media/Icon';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useCountdown } from '../../hooks/useCountdown';
import { useChallengeDetail } from '../../hooks/useChallenges';
import { syncStepsNow } from '../../services/steps';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { ChallengeCta } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';
import { formatDateRange, todayIso } from '../../utils/date';

const makeStyles = ({ spacing, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xl, gap: spacing.md },
    /** Bleeds through the screen's gutter so the rule runs edge to edge. */
    bar: {
      marginHorizontal: -spacing.base,
      paddingHorizontal: spacing.base,
      paddingTop: spacing.md,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
  });

/**
 * One challenge in full: what it asks for, how far the user has got today,
 * what finishing pays, the rules behind it, and who else is walking it.
 *
 * Everything is the server's (`GET /challenges/:id?date=`). There is nothing
 * to join and nothing to claim — every member is enrolled in every open
 * challenge and the server completes one the moment its goal is reached
 * (RULES C4, C5) — so the button at the foot is never a submit. It is the way
 * to the screen where the figure the challenge counts actually moves, and
 * which screen that is, is the server's call too: a workout challenge has no
 * business sending anyone to the step tracker.
 *
 * The day comes in as a route param so a member looking back at Tuesday's
 * board opens Tuesday's challenge rather than today's. Which tab is showing is
 * screen state: it is a way of looking at one challenge, not a fact about it,
 * and a tab that survived into the next challenge would open the roster of a
 * challenge the member had just tapped to read about.
 *
 * The countdown is driven off the server's `endsAt` rather than a duration it
 * sends, so an app left in the background comes back showing the truth instead
 * of the time it had when the user walked away.
 */
export const ChallengeDetailScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { params } =
    useRoute<RootStackScreenProps<'ChallengeDetail'>['route']>();
  const date = params.date ?? todayIso();

  const [tab, setTab] = useState<ChallengeDetailTab>('about');
  const detail = useChallengeDetail(params.id, date);

  // Seconds to the deadline, re-read from it rather than counted down from a
  // number the server sent. Null once it has passed, which is what takes the
  // clock off the card instead of leaving it stuck at zero.
  const secondsToEnd = useMemo(() => {
    if (!detail.data) return null;
    const left = Math.floor(
      (Date.parse(detail.data.focus.endsAt) - Date.now()) / 1000,
    );
    return left > 0 ? left : null;
  }, [detail.data]);
  const countdown = useCountdown(secondsToEnd);

  const [refreshing, setRefreshing] = useState(false);
  const { reload } = detail;
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
    navigation.navigate('Challenges');
  }, [navigation]);

  const shareText = detail.data?.shareText;
  const onPressShare = useCallback(() => {
    if (!shareText) return;
    // A failed or dismissed share is not an error worth a dialog of its own:
    // the sheet is the user's to cancel.
    Share.share({ message: shareText }).catch(() => {});
  }, [shareText]);

  const onPressViewAll = useCallback(() => setTab('participants'), []);

  const onOpenBadge = useCallback(
    (id: string) => navigation.navigate('AchievementDetail', { id }),
    [navigation],
  );

  const action = detail.data?.cta.action;
  const onPressCta = useCallback(() => {
    const go: Record<ChallengeCta['action'], () => void> = {
      track_steps: () => navigation.navigate('StepTracking'),
      go_home: () => navigation.navigate('Main', { screen: 'Home' }),
      view_board: onPressBack,
      none: () => {},
    };
    if (action) go[action]();
  }, [action, navigation, onPressBack]);

  if (!detail.data) {
    return (
      <Screen edges={['top']}>
        <LoadState
          loading={detail.loading}
          title="Couldn't load this challenge"
          message={detail.error}
          onRetry={detail.reload}
        />
      </Screen>
    );
  }

  const { challenge, period, cta } = detail.data;

  return (
    <Screen edges={['top','bottom']}>
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
        <ChallengeDetailHero
          title={challenge.title}
          description={challenge.description}
          cadence={challenge.cadence}
          range={formatDateRange(period.start, period.end)}
          joined={detail.data.joined}
          onPressBack={onPressBack}
          onPressShare={onPressShare}
        />

        <ChallengeProgressCard
          detail={detail.data}
          secondsLeft={countdown.isFinished ? null : countdown.secondsLeft}
        />

        <ChallengeRewardCard
          reward={detail.data.reward}
          completed={challenge.completedAt !== null}
          onPressBadge={onOpenBadge}
        />

        <ChallengeDetailTabs value={tab} onChange={setTab} />

        {tab === 'about' ? (
          <>
            <ChallengeRulesCard rules={detail.data.rules} />
            <TopParticipantsCard
              participants={detail.data.standings}
              metric={challenge.metric}
              goal={challenge.goal}
              onPressViewAll={onPressViewAll}
            />
          </>
        ) : tab === 'leaderboard' ? (
          <ChallengeStandingsCard detail={detail.data} />
        ) : (
          <ChallengeParticipantsCard detail={detail.data} />
        )}
      </ScrollView>

      <View style={styles.bar}>
        {cta.action === 'none' ? (
          <AppText variant="caption" color="textSecondary" center>
            {cta.label}
          </AppText>
        ) : (
          <Button
            label={cta.label}
            variant="brand"
            size="lg"
            fullWidth
            onPress={onPressCta}
            icon={
              <Icon
                as={ArrowRight}
                size="sm"
                tint={colors.primaryForeground}
              />
            }
            iconPosition="trailing"
          />
        )}
      </View>
    </Screen>
  );
};
