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
 * The nutrition screen's masthead — the same shape as the challenge board's,
 * so the two screens the dashboard's shortcut row leads to open the same way.
 */
export const NutritionHeader = memo(
  ({
    name,
    avatarUri,
    hasUnreadNotifications = false,
    onPressBack,
    onPressNotifications,
    onPressAvatar,
    title = 'Nutrition & Goal',
    subtitle = 'Eat right. Fuel your body. Achieve your goal.',
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

NutritionHeader.displayName = 'NutritionHeader';
