import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Bell } from 'lucide-react-native';
import { spacing } from '../../theme';
import { Wordmark } from '../brand/Wordmark';
import { Avatar } from '../media/Avatar';
import { AppText } from '../ui/AppText';
import { IconButton } from '../ui/IconButton';
import { Pressable } from '../form/Pressable';

interface Props {
  /** Null while the profile is still loading or the user is a guest. */
  name?: string | null;
  avatarUri?: string | null;
  hasUnreadNotifications?: boolean;
  onPressNotifications: () => void;
  onPressAvatar: () => void;
  subtitle?: string;
}

/** First name only — a greeting with a full legal name reads like a form. */
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * The Home screen's masthead: wordmark and actions on one row, greeting
 * beneath.
 *
 * The greeting falls back to a generic line rather than to an empty space, so
 * the header keeps its height while the profile loads and nothing below it
 * jumps once the name arrives.
 */
export const HomeHeader = memo(
  ({
    name,
    avatarUri,
    hasUnreadNotifications = false,
    onPressNotifications,
    onPressAvatar,
    subtitle = 'Stay active, stay healthy!',
  }: Props) => {
    const displayName = name ? firstNameOf(name) : null;

    return (
      <View style={styles.container}>
        <View style={styles.topRow}>
          <Wordmark size="md" />

          <View style={styles.actions}>
            <IconButton
              icon={Bell}
              onPress={onPressNotifications}
              badge={hasUnreadNotifications}
              accessibilityLabel={
                hasUnreadNotifications
                  ? 'Notifications, unread'
                  : 'Notifications'
              }
            />
            <Pressable
              onPress={onPressAvatar}
              feedback="scale"
              accessibilityRole="button"
              accessibilityLabel="Your profile"
            >
              <Avatar name={name ?? 'vokve'} uri={avatarUri} size="md" ring />
            </Pressable>
          </View>
        </View>

        <View style={styles.greeting}>
          <AppText variant="h2">
            {displayName ? `Hello, ${displayName}! 👋` : 'Welcome! 👋'}
          </AppText>
          <AppText variant="body" color="textSecondary">
            {subtitle}
          </AppText>
        </View>
      </View>
    );
  },
);

HomeHeader.displayName = 'HomeHeader';

const styles = StyleSheet.create({
  container: { paddingTop: spacing.sm, gap: spacing.base },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  greeting: { gap: spacing.xxs },
});
