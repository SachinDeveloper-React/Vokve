import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AccountHeader } from '../../components/account/AccountHeader';
import { AccountMenuList } from '../../components/account/AccountMenuList';
import { AccountShortcutsRow } from '../../components/account/AccountShortcutsRow';
import { AppearanceSheet } from '../../components/account/AppearanceSheet';
import { BadgeShelf } from '../../components/account/BadgeShelf';
import { DataSafetyNote } from '../../components/account/DataSafetyNote';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner';
import { PremiumUpsellCard } from '../../components/account/PremiumUpsellCard';
import { ProfileCompletenessCard } from '../../components/account/ProfileCompletenessCard';
import { ProfileSummaryCard } from '../../components/account/ProfileSummaryCard';
import { Screen } from '../../components/ui/Screen';
import { config } from '../../constants/config';
import { useAccountStore, useProfileSummary } from '../../stores/accountStore';
import {
  useAuthStatus,
  useAuthStore,
  useCurrentUser,
} from '../../stores/authStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useHasUnreadNotifications } from '../../stores/notificationsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { ProfileGap } from '../../types/models';
import { logger } from '../../utils/logger';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * The account tab: who the user is, what they have earned, and everywhere else
 * the app lets them go from here.
 *
 * Everything on the panel is the server's summary (`GET /me/profile`): the
 * level, the rank, the streak, the badges, the completeness. It is fetched on
 * sign-in and refreshed when the tab is opened on a summary older than a
 * minute, because a level that moved while the user was on another screen
 * should be right by the time they look at it. The coin balance comes from
 * the wallet store instead — that one changes on every spend and the wallet
 * is the thing that knows first.
 *
 * A `ScrollView` of sections rather than a list. Nothing here grows without
 * bound — the menu is a fixed list and the shortcut row a fixed five — so a
 * virtualised list would cost a recycler and buy nothing.
 */
export const AccountScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const user = useCurrentUser();
  const balance = useCoinBalance();
  const hasUnreadNotifications = useHasUnreadNotifications();
  const isSignedIn = useAuthStatus() === 'authenticated';
  const signOut = useAuthStore(s => s.signOut);

  const summary = useProfileSummary();
  const isSyncing = useAccountStore(s => s.isSyncing);
  const syncedAt = useAccountStore(s => s.syncedAt);
  const hydrateProfile = useAccountStore(s => s.hydrateFromServer);
  const refreshProfileIfStale = useAccountStore(s => s.refreshIfStale);

  const [isAppearanceOpen, setAppearanceOpen] = useState(false);

  // The profile carries figures that move elsewhere in the app — a coin
  // earned on the home screen, an order placed in the shop — so the tab
  // re-checks on focus, stale-checked and only with a session.
  useEffect(() => {
    if (!isSignedIn) {
      return undefined;
    }
    refreshProfileIfStale();
    return navigation.addListener('focus', refreshProfileIfStale);
  }, [isSignedIn, navigation, refreshProfileIfStale]);

  const openAppearance = useCallback(() => setAppearanceOpen(true), []);
  const closeAppearance = useCallback(() => setAppearanceOpen(false), []);

  const handleSignOut = useCallback(() => {
    signOut().catch(error =>
      logger.error('AccountScreen', 'Sign out failed', error),
    );
  }, [signOut]);

  const go = useCallback(
    (
        route:
          | 'Streak'
          | 'Orders'
          | 'NotificationSettings'
          | 'LeaderboardRewards'
          | 'Notifications'
          | 'EditProfile'
          | 'Privacy'
          | 'Security'
          | 'HelpSupport'
          | 'About'
          | 'HealthCheckup'
          | 'Wishlist',
      ) =>
      () =>
        navigation.navigate(route),
    [navigation],
  );

  /** A gap on the completeness card opens the form already on that field. */
  const onPressGap = useCallback(
    (field: ProfileGap['field']) => {
      if (field === 'email' || field === 'phone') {
        navigation.navigate('Security');
        return;
      }
      if (field === 'address') {
        navigation.navigate('Addresses');
        return;
      }
      navigation.navigate('EditProfile', { focus: field });
    },
    [navigation],
  );

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isSyncing && syncedAt !== null}
            onRefresh={hydrateProfile}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <AccountHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          hasUnreadNotifications={hasUnreadNotifications}
          onPressNotifications={go('Notifications')}
          onPressAvatar={go('EditProfile')}
        />

        <EmailVerificationBanner reason="place orders and receive payouts" />

        <ProfileSummaryCard
          name={user?.name}
          avatarUri={user?.avatarUrl}
          summary={summary}
          coins={balance}
          onPress={go('EditProfile')}
        />

        {summary ? (
          <ProfileCompletenessCard
            percent={summary.completeness}
            gaps={summary.gaps}
            onPressGap={onPressGap}
          />
        ) : null}

        <AccountShortcutsRow
          onPressEditProfile={go('EditProfile')}
          onPressPrivacy={go('Privacy')}
          onPressNotifications={go('NotificationSettings')}
          onPressAppearance={openAppearance}
          onPressSecurity={go('Security')}
        />

        {summary ? <BadgeShelf badges={summary.badges} /> : null}

        <PremiumUpsellCard onPressUpgrade={go('LeaderboardRewards')} />

        <AccountMenuList
          appVersion={config.appVersion}
          onPressOrders={go('Orders')}
          onPressWishlist={go('Wishlist')}
          onPressRewards={go('LeaderboardRewards')}
          onPressStreakFreeze={go('Streak')}
          onPressHealthData={go('HealthCheckup')}
          onPressHelp={go('HelpSupport')}
          onPressAbout={go('About')}
          onPressLogOut={handleSignOut}
        />

        <DataSafetyNote />
      </ScrollView>

      <AppearanceSheet visible={isAppearanceOpen} onClose={closeAppearance} />
    </Screen>
  );
};
