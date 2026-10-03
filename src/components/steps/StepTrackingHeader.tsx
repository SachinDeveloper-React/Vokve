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
 * The step tracking screen's masthead — the analytics screen's shape, since
 * the two are reached from the same card. The chevron is there because the
 * screen is pushed over the tab bar.
 */
export const StepTrackingHeader = memo(
  ({
    onPressBack,
    title = 'Step Tracking',
    subtitle = 'Every step counted, with or without a watch.',
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

StepTrackingHeader.displayName = 'StepTrackingHeader';
