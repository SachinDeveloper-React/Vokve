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
 * The wallet's masthead: wordmark and actions on one row, the screen's name
 * beneath.
 *
 * The title is an `h2` rather than the `h1` other screens use. Those screens
 * lead with their title; this one leads with the wordmark, and two headings of
 * the same weight stacked on each other leaves the eye with no order to read
 * them in.
 */
export const WalletHeader = memo(
  ({
    name,
    avatarUri,
    hasUnreadNotifications = false,
    onPressNotifications,
    onPressAvatar,
    title = 'Coin / Wallet',
    subtitle = 'Walk more, earn more, win more!',
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
        <AppText variant="h2">{title}</AppText>
        <AppText variant="caption" color="textSecondary">
          {subtitle}
        </AppText>
      </VStack>
    </VStack>
  ),
);

WalletHeader.displayName = 'WalletHeader';
