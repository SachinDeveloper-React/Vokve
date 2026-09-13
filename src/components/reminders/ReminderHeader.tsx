import React, { memo } from 'react';
import { Bell, ChevronLeft } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { Avatar } from '../media/Avatar';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { IconButton } from '../ui/IconButton';
import { Pressable } from '../form/Pressable';

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
 * The reminder screen's masthead.
 *
 * Built like the leaderboard's rather than the tab mastheads: the chevron
 * takes the wordmark's place because this is a page of a page — reached from
 * hydration, which is itself reached from the dashboard — and three levels in,
 * what the user needs in the corner is the way back, not the logo.
 */
export const ReminderHeader = memo(
  ({
    name,
    avatarUri,
    hasUnreadNotifications = false,
    onPressBack,
    onPressNotifications,
    onPressAvatar,
    title = 'Hydration Reminder',
    subtitle = '💧 Stay hydrated, stay healthy!',
  }: Props) => (
    <HStack align="center" gap="md" pt="sm">
      <Pressable
        onPress={onPressBack}
        feedback="opacity"
        visualSize={24}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Icon as={ChevronLeft} size="lg" color="text" />
      </Pressable>

      <VStack flex={1} gap="xxs">
        <AppText variant="h2" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </AppText>
      </VStack>

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
  ),
);

ReminderHeader.displayName = 'ReminderHeader';
