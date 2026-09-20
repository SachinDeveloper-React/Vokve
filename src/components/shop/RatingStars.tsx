import React, { memo, useCallback } from 'react';
import { Star } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { Icon, type IconSize } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface StarsProps {
  /** 0–5, to a decimal. */
  value: number;
  size?: IconSize;
  /** Shown after the stars: "4.3 (12)". Omitted when there is nothing to show. */
  count?: number;
  /** With no reviews yet, say so rather than drawing five empty stars. */
  emptyLabel?: string;
}

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Five stars, filled to the average, with the figure beside them.
 *
 * A half star is drawn as a full one from 0.5 up: the figure next to the
 * stars is the honest number, and the stars are only there to be read at
 * a glance — a shelf of "4.3"s scanned by the eye, not measured.
 */
export const RatingStars = memo(
  ({ value, size = 'xs', count, emptyLabel }: StarsProps) => {
    const { colors } = useTheme();
    if (count === 0 && emptyLabel) {
      return (
        <AppText variant="micro" color="textTertiary">
          {emptyLabel}
        </AppText>
      );
    }
    return (
      <HStack
        align="center"
        gap="xxs"
        accessibilityLabel={`Rated ${value.toFixed(1)} out of 5${
          count !== undefined ? `, ${count} reviews` : ''
        }`}
      >
        {STARS.map(star => (
          <Icon
            key={star}
            as={Star}
            size={size}
            tint={value >= star - 0.5 ? colors.gold : colors.textQuaternary}
            strokeWidth={value >= star - 0.5 ? 0 : 1.5}
            fill={value >= star - 0.5 ? colors.gold : undefined}
          />
        ))}
        {count !== undefined ? (
          <AppText variant="micro" color="textSecondary">
            {value > 0 ? `${value.toFixed(1)} (${count})` : `(${count})`}
          </AppText>
        ) : null}
      </HStack>
    );
  },
);

RatingStars.displayName = 'RatingStars';

interface PickerProps {
  value: number;
  onChange: (rating: number) => void;
}

const PICKER_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/** Five tappable stars, for the review form. */
export const RatingPicker = memo(({ value, onChange }: PickerProps) => {
  const { colors } = useTheme();
  const pick = useCallback((star: number) => () => onChange(star), [onChange]);
  return (
    <HStack align="center" gap="sm">
      {STARS.map(star => (
        <Pressable
          key={star}
          onPress={pick(star)}
          feedback="scale"
          accessibilityRole="button"
          accessibilityLabel={`${star} star${star > 1 ? 's' : ''}`}
          accessibilityState={{ selected: value === star }}
        >
          <Icon
            as={Star}
            size="xl"
            tint={value >= star ? colors.gold : colors.textQuaternary}
            strokeWidth={value >= star ? 0 : 1.5}
            fill={value >= star ? colors.gold : undefined}
          />
        </Pressable>
      ))}
      <AppText variant="caption" color="textSecondary">
        {PICKER_LABELS[value] ?? ''}
      </AppText>
    </HStack>
  );
});

RatingPicker.displayName = 'RatingPicker';
