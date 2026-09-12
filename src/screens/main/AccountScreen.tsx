import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AccountHeader } from '../../components/account/AccountHeader';
import { AccountMenuList } from '../../components/account/AccountMenuList';
import { AccountShortcutsRow } from '../../components/account/AccountShortcutsRow';
import { AppearanceSheet } from '../../components/account/AppearanceSheet';
import { DataSafetyNote } from '../../components/account/DataSafetyNote';
import { PremiumUpsellCard } from '../../components/account/PremiumUpsellCard';
import { ProfileSummaryCard } from '../../components/account/ProfileSummaryCard';
import { Screen } from '../../components/ui/Screen';
import { config } from '../../constants/config';
import { profileHighlights } from '../../constants/seedData';
import { useAuthStore, useCurrentUser } from '../../stores/authStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useCurrentStreak } from '../../stores/streakStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { logger } from '../../utils/logger';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * The account tab: who the user is, what they have earned, and everywhere else
 * the app lets them go from here.
 *
 * A `ScrollView` of sections rather than a list. Nothing here grows without
 * bound — the menu is a fixed seven rows and the shortcut row a fixed five —
 * so a virtualised list would cost a recycler and buy nothing.
 *
 * Coins and the streak are live from their stores — the streak from the same
 * day list the streak screen draws its calendar from, so the two never
 * disagree; level, rank, join date, achievements and lifetime steps come from
 * `profileHighlights` because no API carries them yet. They are read here rather than inside the panel so the
 * panel takes plain props and the seed goes in one edit when the real source
 * lands.
 */
export const AccountScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const user = useCurrentUser();
  const balance = useCoinBalance();
  const currentStreak = useCurrentStreak();
  const signOut = useAuthStore(s => s.signOut);

  const [isAppearanceOpen, setAppearanceOpen] = useState(false);

  const openAppearance = useCallback(() => setAppearanceOpen(true), []);
  const closeAppearance = useCallback(() => setAppearanceOpen(false), []);

  const handleSignOut = useCallback(() => {
    signOut().catch(error =>
      logger.error('AccountScreen', 'Sign out failed', error),
    );
  }, [signOut]);

  const onOpenWallet = useCallback(
    () => navigation.navigate('Main', { screen: 'Wallet' }),
    [navigation],
  );

  // Through the full path rather than a bare `navigate('Streak')`: the hook
  // is typed against the root list, and the nested form is what still works
  // when this screen is reached from another tab.
  const onOpenStreak = useCallback(
    () =>
      navigation.navigate('Main', {
        screen: 'Account',
        params: { screen: 'Streak' },
      }),
    [navigation],
  );

  // Destinations the app has not built yet — the full profile, orders,
  // rewards, help. Wired as no-ops rather than left off, so each row keeps the
  // shape it will ship with and only the handler changes when its screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <AccountHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          hasUnreadNotifications
          onPressNotifications={notImplemented}
          onPressAvatar={notImplemented}
        />

        <ProfileSummaryCard
          name={user?.name}
          avatarUri={user?.avatarUrl}
          level={profileHighlights.level}
          tierTitle={profileHighlights.tierTitle}
          memberSince={profileHighlights.memberSince}
          coins={balance}
          streakDays={currentStreak}
          achievements={profileHighlights.achievements}
          totalSteps={profileHighlights.totalSteps}
          onPress={notImplemented}
        />

        <AccountShortcutsRow
          onPressEditProfile={notImplemented}
          onPressPrivacy={notImplemented}
          onPressNotifications={notImplemented}
          onPressAppearance={openAppearance}
          onPressSecurity={notImplemented}
        />

        <PremiumUpsellCard onPressUpgrade={notImplemented} />

        <AccountMenuList
          appVersion={config.appVersion}
          onPressOrders={notImplemented}
          onPressRewards={onOpenWallet}
          onPressStreakFreeze={onOpenStreak}
          onPressHealthData={notImplemented}
          onPressHelp={notImplemented}
          onPressAbout={notImplemented}
          onPressLogOut={handleSignOut}
        />

        <DataSafetyNote />
      </ScrollView>

      <AppearanceSheet visible={isAppearanceOpen} onClose={closeAppearance} />
    </Screen>
  );
};
