import React, { memo } from 'react';
import { ChevronLeft, SlidersHorizontal } from 'lucide-react-native';
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
  onPressBack: () => void;
  onPressSettings: () => void;
  onPressAvatar: () => void;
  title?: string;
  subtitle?: string;
}

/**
 * The notification centre's masthead — the same shape as the home, wallet,
 * shop and streak mastheads, so the family stays recognisable as the user
 * moves between them.
 *
 * Two things differ. The action beside the avatar is a slider rather than the
 * bell — a bell that opens the screen it is already on is a dead control — and
 * it leads to the preferences the footer row also offers, which is the only
 * other thing this screen does.
 *
 * The other is the chevron. Every masthead above belongs to a tab, where the
 * bar itself is the way out; this screen is pushed over the bar from whichever
 * tab the user was on, so without a chevron the only way back is the platform's
 * own gesture. The wordmark stays beside it: the chevron says where the screen
 * came from, the wordmark says which app it belongs to, and dropping the latter
 * would make this the one header in the app that is missing it.
 */
export const NotificationsHeader = memo(
  ({
    name,
    avatarUri,
    onPressBack,
    onPressSettings,
    onPressAvatar,
    title = 'Notifications',
    subtitle = 'Stay updated with your activity and alerts.',
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
            icon={SlidersHorizontal}
            onPress={onPressSettings}
            accessibilityLabel="Notification settings"
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

NotificationsHeader.displayName = 'NotificationsHeader';
