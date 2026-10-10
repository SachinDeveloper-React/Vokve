import React, { useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Volume2 } from 'lucide-react-native';
import { ReminderHeader } from '../../components/reminders/ReminderHeader';
import { ReminderSoundRow } from '../../components/reminders/ReminderSoundRow';
import { Divider } from '../../components/layout/Divider';
import { VStack } from '../../components/layout/Stack';
import { useToast } from '../../components/feedback';
import { InfoNote } from '../../components/feedback/InfoNote';
import { AppText } from '../../components/ui/AppText';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { useReminderSounds } from '../../hooks/useReminderSounds';
import { DEFAULT_SOUND_ID } from '../../constants/reminderSounds';
import {
  previewReminderSound,
  type PreviewResult,
} from '../../services/notifications';
import { useCurrentUser } from '../../stores/authStore';
import { useHasUnreadNotifications } from '../../stores/notificationsStore';
import {
  useReminderSound,
  useReminderVibration,
  useRemindersStore,
} from '../../stores/remindersStore';
import { useThemedStyles, type ThemeShape } from '../../theme';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * Which sound a reminder arrives with (RULES Y5).
 *
 * The list is the server's, narrowed to the sounds this build has audio for
 * — a sound the app cannot play is one the picker must not offer. A tap is
 * the choice and is saved at once, the way every other control on the
 * reminder plan is: there is no "Save", because there is nothing here a
 * user would want to change and then abandon.
 *
 * Each row can be played without being chosen, and played as a real
 * notification rather than through an audio player — which is the only way
 * to hear what it will actually sound like, at the volume and under the
 * do-not-disturb rules that will apply when it rings for real.
 */
export const ReminderSoundScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const user = useCurrentUser();
  const hasUnreadNotifications = useHasUnreadNotifications();

  const sounds = useReminderSounds();
  const selected = useReminderSound() || DEFAULT_SOUND_ID;
  const vibration = useReminderVibration();
  const setSound = useRemindersStore(s => s.setSound);
  const toast = useToast();

  /**
   * Silence is the one answer a play button must never give on its own: it
   * could be the sound, the phone's volume, a refused permission or a bug,
   * and the user cannot tell which. So a preview that did not ring says why.
   */
  const announce = useCallback(
    (result: PreviewResult) => {
      if (result === 'played') return;
      if (result === 'not_permitted') {
        toast.show({
          title: 'Notifications are turned off',
          message:
            'A reminder sound plays as a notification, so Vokve needs permission to show them. Allow notifications for Vokve in your phone’s settings.',
          tone: 'warning',
          durationMs: 0,
        });
        return;
      }
      toast.show({
        title: 'That sound could not be played',
        message: 'Your phone refused it. Try another, or use Default.',
        tone: 'error',
      });
    },
    [toast],
  );

  const play = useCallback(
    (id: string) => {
      previewReminderSound(id, vibration).then(announce, () =>
        announce('failed'),
      );
    },
    [announce, vibration],
  );

  const onSelect = useCallback(
    (id: string) => {
      setSound(id);
      // Played on the way out, so choosing a sound tells you what you chose
      // without a second tap.
      play(id);
    },
    [play, setSound],
  );

  const onPreview = play;

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('HydrationReminder');
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
      >
        <ReminderHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          hasUnreadNotifications={hasUnreadNotifications}
          onPressBack={onPressBack}
          onPressNotifications={onOpenNotifications}
          onPressAvatar={onOpenAccount}
          title="Reminder Sound"
          subtitle="🔔 Pick what a reminder sounds like"
        />

        <Card radius="xl" padding="base">
          <VStack accessibilityRole="radiogroup">
            {sounds.map((sound, index) => (
              <React.Fragment key={sound.id}>
                {index > 0 ? <Divider /> : null}
                <ReminderSoundRow
                  id={sound.id}
                  label={sound.label}
                  description={sound.description}
                  selected={sound.id === selected}
                  onSelect={onSelect}
                  onPreview={onPreview}
                />
              </React.Fragment>
            ))}
          </VStack>
        </Card>

        <InfoNote
          icon={Volume2}
          title="Played the way it will arrive"
          message="A sample rings as a real notification — at your phone's notification volume, and silenced by Do Not Disturb. If you hear nothing, check both."
        />

        <AppText variant="micro" color="textTertiary">
          On iPhone a reminder vibrates whenever it has a sound, so the
          Vibration switch applies on Android.
        </AppText>
      </ScrollView>
    </Screen>
  );
};
