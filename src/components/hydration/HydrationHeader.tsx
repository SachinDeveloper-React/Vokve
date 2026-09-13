import React, { memo } from 'react';
import { AlarmClock, ChevronLeft } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { IconButton } from '../ui/IconButton';
import { Wordmark } from '../brand/Wordmark';

interface Props {
  onPressBack: () => void;
  onPressReminders: () => void;
  title?: string;
  subtitle?: string;
}

/**
 * The hydration screen's masthead.
 *
 * No bell and no avatar, unlike the tab mastheads: this is a single-subject
 * screen the user came to in order to log a drink, and actions in the corner
 * that lead elsewhere in the app are ways to lose the thing they opened it
 * for. The clock is the exception, and belongs to the subject: the reminders
 * that bring somebody back to this screen are set from it.
 */
export const HydrationHeader = memo(
  ({
    onPressBack,
    onPressReminders,
    title = 'Hydration',
    subtitle = 'Stay hydrated. Stay healthy.',
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

        <IconButton
          icon={AlarmClock}
          onPress={onPressReminders}
          accessibilityLabel="Hydration reminders"
        />
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

HydrationHeader.displayName = 'HydrationHeader';
