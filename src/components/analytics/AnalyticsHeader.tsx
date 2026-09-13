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
 * The analytics screen's masthead.
 *
 * No actions in the corner: this screen is a readout, and the only thing a
 * user wants from its header is the way back out. The chevron is there because
 * the screen is pushed over the tab bar.
 */
export const AnalyticsHeader = memo(
  ({
    onPressBack,
    title = 'Steps Analytics',
    subtitle = 'Track your progress. Analyze your performance.',
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

AnalyticsHeader.displayName = 'AnalyticsHeader';
