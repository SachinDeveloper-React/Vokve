import React, { memo } from 'react';
import { Bell } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { Avatar } from '../media/Avatar';
import { AppText } from '../ui/AppText';
import { IconButton } from '../ui/IconButton';
import { Pressable } from '../form/Pressable';
import { Wordmark } from '../brand/Wordmark';

interface Props {
  /** Null while the profile is still loading or the user is a guest. */
  name?: string | null;
  avatarUri?: string | null;
  hasUnreadNotifications?: boolean;
  onPressNotifications: () => void;
  onPressAvatar: () => void;
  title?: string;
  subtitle?: string;
}

/**
 * The streak screen's masthead — the same shape as the account and shop
 * mastheads, so the four sit as one family when the user moves between them.
 *
 * No back button, on purpose: this screen sits inside the Account tab's own
 * stack, so the platform's swipe and hardware back both return to Account,
 * and a chevron in the wordmark's place would be the one header in the app
 * that looked different.
 */
export const StreakHeader = memo(
  ({
    name,
    avatarUri,
    hasUnreadNotifications = false,
    onPressNotifications,
    onPressAvatar,
    title = 'Streaks',
    subtitle = 'Consistency is the key to your success.',
  }: Props) => (
    <VStack gap="base" pt="sm">
      <HStack align="center" justify="between">
        <Wordmark size="md" />

        <HStack align="center" gap="md">
          <IconButton
            icon={Bell}
            onPress={onPressNotifications}
            badge={hasUnreadNotifications}
            accessibilityLabel={
              hasUnreadNotifications ? 'Notifications, unread' : 'Notifications'
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
        </HStack>
      </HStack>

      <VStack gap="xxs">
        <AppText variant="h1">{title}</AppText>
        <AppText variant="caption" color="textSecondary">
          {subtitle}
        </AppText>
      </VStack>
    </VStack>
  ),
);

StreakHeader.displayName = 'StreakHeader';
