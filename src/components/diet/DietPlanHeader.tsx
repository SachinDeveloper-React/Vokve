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
 * The diet plan's masthead.
 *
 * No actions in the corner: the screen's own controls — the tabs, the day
 * pager, "Add Meal" — are all in the body, and a header action would be a
 * fourth place to look for the same kind of thing.
 */
export const DietPlanHeader = memo(
  ({
    onPressBack,
    title = 'Diet Plan',
    subtitle = 'Eat healthy. Stay consistent. Be your best.',
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

DietPlanHeader.displayName = 'DietPlanHeader';
