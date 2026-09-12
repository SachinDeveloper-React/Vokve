import React, { memo } from 'react';
import { ChevronLeft } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { IconButton } from '../ui/IconButton';
import { Wordmark } from '../brand/Wordmark';

interface Props {
  onPressBack: () => void;
  title?: string;
  subtitle?: string;
}

/**
 * The hydration screen's masthead.
 *
 * No bell and no avatar, unlike the tab mastheads: this is a single-subject
 * screen the user came to in order to log a drink, and two actions in the
 * corner that lead somewhere else are two ways to lose the thing they opened
 * it for. The chevron is the only control, because this screen is pushed over
 * the tab bar and something has to bring the user back.
 */
export const HydrationHeader = memo(
  ({
    onPressBack,
    title = 'Hydration',
    subtitle = 'Stay hydrated. Stay healthy.',
  }: Props) => (
    <VStack gap="base" pt="sm">
      <HStack align="center" gap="md">
        <IconButton
          icon={ChevronLeft}
          onPress={onPressBack}
          accessibilityLabel="Back"
        />

        <Wordmark size="md" />
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
