import React, { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { BellRing, Droplets, Footprints, Gift } from 'lucide-react-native';
import { PermissionStepLayout } from '../../components';
import { usePermissionStep } from '../../navigation/permissionsFlow';
import { enablePushNotifications } from '../../services/push';
import { useTheme } from '../../theme';

/**
 * Notifications: the live step count the tracker keeps in the shade, and
 * the pushes the server sends. Whatever the user answers, the flow moves
 * on — the feed in the app has everything either way.
 */
export const NotificationPermissionScreen = () => {
  const { colors } = useTheme();
  const { position, total, next } = usePermissionStep('notifications');
  const [busy, setBusy] = useState(false);

  const onAllow = useCallback(async () => {
    setBusy(true);
    await enablePushNotifications();
    setBusy(false);
    next();
  }, [next]);

  return (
    <PermissionStepLayout
      step={position}
      total={total}
      icon={BellRing}
      tint={colors.avatarOrange}
      title="Stay on track"
      message="Turn on notifications and Vokve keeps you posted — only what matters to you, and you choose which."
      points={[
        {
          icon: Footprints,
          text: 'Your live step count in the notification bar',
        },
        {
          icon: Droplets,
          text: 'Water reminders, and a nudge before your streak slips',
        },
        { icon: Gift, text: 'Coins earned, orders and challenge results' },
      ]}
      allowLabel="Allow notifications"
      onAllow={onAllow}
      busy={busy}
      onSkip={next}
      footnote={
        Platform.OS === 'android'
          ? 'Android will ask to allow notifications. You can pick what you get in Settings.'
          : 'You can pick what you get in Settings.'
      }
    />
  );
};
