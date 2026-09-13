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
 * The checkup screen's masthead.
 *
 * No actions beside the wordmark: everything this screen does — logging a
 * reading, opening the trends — is a control in the section it belongs to,
 * where the user is already looking. The chevron is there because the screen
 * is pushed over the tab bar.
 */
export const HealthHeader = memo(
  ({
    onPressBack,
    title = 'Health Checkup',
    subtitle = 'Track your vitals. Know your body better.',
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

HealthHeader.displayName = 'HealthHeader';
