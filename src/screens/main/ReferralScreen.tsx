import React, { useCallback, useMemo } from 'react';
import { ScrollView, Share, StyleSheet } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useNavigation } from '@react-navigation/native';
import { useToast } from '../../components/feedback/Toast';
import { HowReferralWorksCard } from '../../components/referral/HowReferralWorksCard';
import { ReferralCodeCard } from '../../components/referral/ReferralCodeCard';
import { ReferralHeader } from '../../components/referral/ReferralHeader';
import { ReferralHeroBanner } from '../../components/referral/ReferralHeroBanner';
import { ReferralStatsCard } from '../../components/referral/ReferralStatsCard';
import { ReferralsCard } from '../../components/referral/ReferralsCard';
import { Screen } from '../../components/ui/Screen';
import { referralCode, seedReferrals } from '../../constants/seedData';
import { useCurrentUser } from '../../stores/authStore';
import { useHasUnreadNotifications } from '../../stores/notificationsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { logger } from '../../utils/logger';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/** What goes into the share sheet, with the code where it is easy to copy. */
function shareMessageFor(code: string): string {
  return `Join me on VOKVE — walk, earn coins and win rewards. Use my code ${code} when you sign up and we both get coins!`;
}

/**
 * Referral & Earn: the user's code, what it has earned, and who joined on it.
 *
 * The figures at the top are counted from the referral list rather than kept
 * beside it, so the number of friends and the coins they earned cannot
 * disagree with the rows at the bottom.
 *
 * Copy and share go through the platform — the clipboard and the system share
 * sheet — rather than an in-app picker of messaging apps. The sheet already
 * knows which apps are installed and which the user shares to most, and it
 * is the one place a new messaging app shows up without an app update.
 */
export const ReferralScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const toast = useToast();
  const user = useCurrentUser();
  const hasUnreadNotifications = useHasUnreadNotifications();

  const stats = useMemo(() => {
    const rewarded = seedReferrals.filter(
      referral => referral.status === 'rewarded',
    );
    return {
      successful: rewarded.length,
      pending: seedReferrals.length - rewarded.length,
      coinsEarned: rewarded.reduce(
        (sum, referral) => sum + referral.rewardCoins,
        0,
      ),
    };
  }, []);

  const onPressCopy = useCallback(() => {
    Clipboard.setString(referralCode);
    toast.show({
      title: 'Code copied',
      message: `${referralCode} is on your clipboard.`,
      tone: 'success',
    });
  }, [toast]);

  const onPressShare = useCallback(async () => {
    try {
      await Share.share({ message: shareMessageFor(referralCode) });
    } catch (error) {
      // A dismissed share sheet rejects on some platforms; that is not an error
      // the user needs to hear about.
      logger.warn('ReferralScreen', 'Share dismissed or failed', error);
    }
  }, []);

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

  // The full referral list has no screen yet. Wired as a no-op rather than
  // left off, so the link keeps the shape it will ship with and only the
  // handler changes when that screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ReferralHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          hasUnreadNotifications={hasUnreadNotifications}
          onPressBack={onPressBack}
          onPressNotifications={onOpenNotifications}
          onPressAvatar={onOpenAccount}
        />

        <ReferralHeroBanner />

        <ReferralCodeCard
          code={referralCode}
          onPressCopy={onPressCopy}
          onPressShare={onPressShare}
        />

        <ReferralStatsCard
          successful={stats.successful}
          pending={stats.pending}
          coinsEarned={stats.coinsEarned}
        />

        <HowReferralWorksCard />

        <ReferralsCard
          referrals={seedReferrals}
          onPressViewAll={notImplemented}
        />
      </ScrollView>
    </Screen>
  );
};
