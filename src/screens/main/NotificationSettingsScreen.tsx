import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useToast } from '../../components/feedback/Toast';
import { NotificationCategoriesCard } from '../../components/settings/NotificationCategoriesCard';
import { NotificationIntroCard } from '../../components/settings/NotificationIntroCard';
import { NotificationPreferencesCard } from '../../components/settings/NotificationPreferencesCard';
import { NotificationSettingsHeader } from '../../components/settings/NotificationSettingsHeader';
import { PrivacyNoteCard } from '../../components/settings/PrivacyNoteCard';
import { QuietHoursSheet } from '../../components/settings/QuietHoursSheet';
import { Screen } from '../../components/ui/Screen';
import { useAuthStatus } from '../../stores/authStore';
import { useCoinBalance } from '../../stores/coinsStore';
import {
  useAllCategoriesEnabled,
  useEmailNotifications,
  useNotificationCategories,
  useNotificationSaveError,
  useNotificationSettingsStore,
  useQuietHours,
  useSmsNotifications,
} from '../../stores/notificationSettingsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * What the app is allowed to tell the user about, and how.
 *
 * Every switch writes straight to the settings store rather than being
 * collected behind a Save: these are consent, and a screen that made somebody
 * confirm turning a notification off would be arguing with them. There is
 * nothing to cancel, which is why the screen has no footer. The store sends
 * each flip to the server as it happens and puts the switch back if it is
 * refused — which this screen reports, once, in a toast.
 *
 * Separate from the notification centre, which is the feed. This decides what
 * is ever sent; that shows what already was.
 */
export const NotificationSettingsScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const toast = useToast();
  const isSignedIn = useAuthStatus() === 'authenticated';

  const coins = useCoinBalance();
  const categories = useNotificationCategories();
  const canEnableAll = !useAllCategoriesEnabled();
  const quietHours = useQuietHours();
  const sms = useSmsNotifications();
  const email = useEmailNotifications();

  const setCategory = useNotificationSettingsStore(s => s.setCategory);
  const enableAll = useNotificationSettingsStore(s => s.enableAll);
  const setQuietHours = useNotificationSettingsStore(s => s.setQuietHours);
  const setSms = useNotificationSettingsStore(s => s.setSms);
  const setEmail = useNotificationSettingsStore(s => s.setEmail);
  const hydrateFromServer = useNotificationSettingsStore(
    s => s.hydrateFromServer,
  );
  const saveError = useNotificationSaveError();
  const clearSaveError = useNotificationSettingsStore(s => s.clearSaveError);

  // The server's copy is the one it enforces: read it on open so a change
  // made on another device is what the switches show.
  useEffect(() => {
    if (isSignedIn) {
      hydrateFromServer();
    }
  }, [hydrateFromServer, isSignedIn]);

  // A refused write has already put the switch back; this says why.
  useEffect(() => {
    if (saveError) {
      toast.show({
        title: "Couldn't save that",
        message: saveError,
        tone: 'warning',
      });
      clearSaveError();
    }
  }, [clearSaveError, saveError, toast]);

  const [isQuietOpen, setQuietOpen] = useState(false);
  const openQuiet = useCallback(() => setQuietOpen(true), []);
  const closeQuiet = useCallback(() => setQuietOpen(false), []);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  const onOpenWallet = useCallback(
    () => navigation.navigate('Main', { screen: 'Wallet' }),
    [navigation],
  );

  // The privacy policy has no screen yet. Wired as a no-op rather than left
  // off, so the card keeps the shape it will ship with and only the handler
  // changes when that screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <NotificationSettingsHeader
          coins={coins}
          onPressBack={onPressBack}
          onPressCoins={onOpenWallet}
        />

        <NotificationIntroCard />

        <NotificationCategoriesCard
          categories={categories}
          canEnableAll={canEnableAll}
          onChange={setCategory}
          onPressEnableAll={enableAll}
        />

        <NotificationPreferencesCard
          quietHours={quietHours}
          sms={sms}
          email={email}
          onPressQuietHours={openQuiet}
          onChangeSms={setSms}
          onChangeEmail={setEmail}
        />

        <PrivacyNoteCard onPress={notImplemented} />
      </ScrollView>

      <QuietHoursSheet
        visible={isQuietOpen}
        value={quietHours}
        onChange={setQuietHours}
        onClose={closeQuiet}
      />
    </Screen>
  );
};
