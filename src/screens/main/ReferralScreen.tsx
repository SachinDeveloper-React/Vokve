import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useNavigation } from '@react-navigation/native';
import { useToast } from '../../components/feedback/Toast';
import { ClaimReferralCard } from '../../components/referral/ClaimReferralCard';
import { HowReferralWorksCard } from '../../components/referral/HowReferralWorksCard';
import { ReferralCodeCard } from '../../components/referral/ReferralCodeCard';
import { ReferralHeader } from '../../components/referral/ReferralHeader';
import { ReferralHeroBanner } from '../../components/referral/ReferralHeroBanner';
import { ReferralStatsCard } from '../../components/referral/ReferralStatsCard';
import { ReferralsCard } from '../../components/referral/ReferralsCard';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { toApiError } from '../../services/api/errors';
import { useAuthStatus, useCurrentUser } from '../../stores/authStore';
import { useHasUnreadNotifications } from '../../stores/notificationsStore';
import {
  describeReferralError,
  useIsApplyingReferral,
  useReferralProgram,
  useReferralStore,
} from '../../stores/referralStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { logger } from '../../utils/logger';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
    empty: { paddingVertical: spacing.xl },
  });

/**
 * Referral & Earn: the user's code, what it has earned, who joined on it,
 * and — for a user who was invited — the code they joined on and the coins
 * it promises.
 *
 * Everything comes from one call, `GET /referrals/me` (RULES F6): the code,
 * the share text and link, the reward amounts and the list. The screen
 * states no figure it did not receive, which is why it shows a spinner
 * rather than the old seeded numbers before the first sync.
 *
 * Copy and share go through the platform — the clipboard and the system share
 * sheet — rather than an in-app picker of messaging apps. The sheet already
 * knows which apps are installed and which the user shares to most, and it
 * is the one place a new messaging app shows up without an app update.
 */
export const ReferralScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const toast = useToast();
  const user = useCurrentUser();
  const hasUnreadNotifications = useHasUnreadNotifications();
  const isSignedIn = useAuthStatus() === 'authenticated';

  const program = useReferralProgram();
  const isApplying = useIsApplyingReferral();
  const isSyncing = useReferralStore(s => s.isSyncing);
  const syncedAt = useReferralStore(s => s.syncedAt);
  const moreReferrals = useReferralStore(s => s.moreReferrals);
  const nextCursor = useReferralStore(s => s.nextCursor);
  const isLoadingMore = useReferralStore(s => s.isLoadingMore);
  const hydrateFromServer = useReferralStore(s => s.hydrateFromServer);
  const refreshIfStale = useReferralStore(s => s.refreshIfStale);
  const loadMore = useReferralStore(s => s.loadMore);
  const apply = useReferralStore(s => s.apply);

  const [isListExpanded, setListExpanded] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (isSignedIn) {
      refreshIfStale();
    }
  }, [isSignedIn, refreshIfStale]);

  const referrals = useMemo(
    () => (program ? [...program.referrals, ...moreReferrals] : []),
    [moreReferrals, program],
  );

  const onPressCopy = useCallback(() => {
    if (!program) {
      return;
    }
    Clipboard.setString(program.code);
    toast.show({
      title: 'Code copied',
      message: `${program.code} is on your clipboard.`,
      tone: 'success',
    });
  }, [program, toast]);

  // The message and link are the server's (RULES F6), so a campaign can ride
  // on them without an app update. iOS takes the URL separately and shows it
  // as a link card; Android folds it into the text, which already carries it.
  const onPressShare = useCallback(async () => {
    if (!program) {
      return;
    }
    try {
      await Share.share({
        message: program.shareMessage,
        url: program.shareUrl,
      });
    } catch (error) {
      // A dismissed share sheet rejects on some platforms; that is not an error
      // the user needs to hear about.
      logger.warn('ReferralScreen', 'Share dismissed or failed', error);
    }
  }, [program]);

  const onApply = useCallback(
    async (code: string) => {
      setApplyError(null);
      try {
        const next = await apply(code);
        toast.show({
          title: 'Code applied',
          message: `${
            next.applied?.rewardCoins ?? next.rewards.invitee
          } coins are yours after your first workout.`,
          tone: 'success',
        });
      } catch (error) {
        const described = describeReferralError(toApiError(error));
        setApplyError(described.title);
        toast.show({
          title: described.title,
          message: described.message,
          tone: 'warning',
        });
      }
    },
    [apply, toast],
  );
  const clearApplyError = useCallback(() => setApplyError(null), []);

  // First tap shows every row already here; later taps fetch the next page.
  const onPressViewAll = useCallback(() => {
    if (!isListExpanded) {
      setListExpanded(true);
      return;
    }
    loadMore();
  }, [isListExpanded, loadMore]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  const onOpenNotifications = useCallback(
    () => navigation.navigate('Notifications'),
    [navigation],
  );

  const onOpenAccount = useCallback(
    () =>
      navigation.navigate('Main', {
        screen: 'Account',
        params: { screen: 'AccountHome' },
      }),
    [navigation],
  );

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isSyncing && syncedAt !== null}
            onRefresh={hydrateFromServer}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <ReferralHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          hasUnreadNotifications={hasUnreadNotifications}
          onPressBack={onPressBack}
          onPressNotifications={onOpenNotifications}
          onPressAvatar={onOpenAccount}
        />

        <ReferralHeroBanner inviterCoins={program?.rewards.inviter ?? null} />

        {program === null ? (
          isSyncing ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <Card radius="xl" style={styles.empty}>
              <EmptyState
                title="Couldn't load your code"
                message="Check your connection and try again."
                actionLabel="Try again"
                onAction={hydrateFromServer}
              />
            </Card>
          )
        ) : (
          <>
            <ReferralCodeCard
              code={program.code}
              onPressCopy={onPressCopy}
              onPressShare={onPressShare}
            />

            <ClaimReferralCard
              rewardCoins={program.rewards.invitee}
              qualifier={program.rewards.qualifier}
              applied={program.applied}
              canApply={program.canApply}
              applyBy={program.applyBy}
              isApplying={isApplying}
              error={applyError}
              onApply={onApply}
              onChangeCode={clearApplyError}
            />

            <ReferralStatsCard
              successful={program.stats.successful}
              pending={program.stats.pending}
              coinsEarned={program.stats.coinsEarned}
            />

            <HowReferralWorksCard
              inviterCoins={program.rewards.inviter}
              inviteeCoins={program.rewards.invitee}
              qualifier={program.rewards.qualifier}
            />

            <ReferralsCard
              referrals={referrals}
              expanded={isListExpanded}
              hasMore={nextCursor !== null}
              isLoadingMore={isLoadingMore}
              onPressViewAll={onPressViewAll}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
};
