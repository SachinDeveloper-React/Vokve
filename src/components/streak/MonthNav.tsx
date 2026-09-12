import React, { memo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { formatMonthYear } from '../../utils/date';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  year: number;
  /** 0-based, as `Date` counts them. */
  month: number;
  onPrevious: () => void;
  onNext: () => void;
  /** Stops paging past the current month — there is nothing there to see. */
  canGoNext: boolean;
}

/** ‹ May 2025 › — the calendar's paging control. */
export const MonthNav = memo(
  ({ year, month, onPrevious, onNext, canGoNext }: Props) => (
    <HStack align="center" gap="sm">
      <Pressable
        onPress={onPrevious}
        feedback="opacity"
        visualSize={24}
        accessibilityRole="button"
        accessibilityLabel="Previous month"
      >
        <Icon as={ChevronLeft} size="sm" color="textSecondary" />
      </Pressable>

      <AppText variant="bodyStrong" accessibilityRole="header">
        {formatMonthYear(year, month)}
      </AppText>

      <Pressable
        onPress={onNext}
        feedback="opacity"
        visualSize={24}
        disabled={!canGoNext}
        accessibilityRole="button"
        accessibilityLabel="Next month"
        accessibilityState={{ disabled: !canGoNext }}
      >
        <Icon
          as={ChevronRight}
          size="sm"
          color={canGoNext ? 'textSecondary' : 'textTertiary'}
        />
      </Pressable>
    </HStack>
  ),
);

MonthNav.displayName = 'MonthNav';
