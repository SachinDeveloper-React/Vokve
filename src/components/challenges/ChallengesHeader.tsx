import React, { memo } from 'react';
import { Bell, ChevronLeft } from 'lucide-react-native';
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
  onPressBack: () => void;
  onPressNotifications: () => void;
  onPressAvatar: () => void;
  title?: string;
  subtitle?: string;
}

/**
 * The challenge board's masthead — the same shape as the home, wallet, shop
 * and streak mastheads, so the family stays recognisable as the user moves
 * between them.
 *
 * The chevron is here for the same reason it is on the notification centre:
 * this screen is pushed over the tab bar from whichever tab the user was on,
 * so without it the only way back is the platform's own gesture. The wordmark
 * keeps its place beside it.
 */
export const ChallengesHeader = memo(
  ({
    name,
    avatarUri,
    hasUnreadNotifications = false,
    onPressBack,
    onPressNotifications,
    onPressAvatar,
    title = 'Challenges & Achievements',
    subtitle = 'Push your limits. Earn rewards. Become your best.',
  }: Props) => (
    <VStack gap="base" pt="sm">
      <HStack align="center" justify="between">
        <HStack align="center" gap="md">
          <IconButton
            icon={ChevronLeft}
            onPress={onPressBack}
            accessibilityLabel="Back"
          />

          <Wordmark size="md" />
        </HStack>

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

ChallengesHeader.displayName = 'ChallengesHeader';
