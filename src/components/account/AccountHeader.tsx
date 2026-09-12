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
 * The account tab's masthead: wordmark and actions on one row, the screen's
 * name beneath.
 *
 * The title is an `h1` where the wallet's is an `h2`. The wallet leads with a
 * balance card that carries the screen; here the panel below is a portrait of
 * the user rather than a headline figure, so the word "Account" is what tells
 * them where they have landed and it has to be the largest type on the row.
 */
export const AccountHeader = memo(
  ({
    name,
    avatarUri,
    hasUnreadNotifications = false,
    onPressNotifications,
    onPressAvatar,
    title = 'Account',
    subtitle = 'Manage your profile and preferences',
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

AccountHeader.displayName = 'AccountHeader';
