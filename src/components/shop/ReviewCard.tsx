import React, { memo } from 'react';
import { BadgeCheck } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { Review } from '../../types/models';
import { formatRelativeDay } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { RatingStars } from './RatingStars';

interface Props {
  review: Review;
  /** Offered on the reader's own review. */
  onEdit?: (review: Review) => void;
}

/**
 * One review: stars, the title if there is one, the words, and who — a
 * first name, a "Verified buyer" tick where the shop sold it to them.
 * The reader's own carries an Edit instead of a byline, since they know
 * who wrote it.
 */
export const ReviewCard = memo(({ review, onEdit }: Props) => {
  const { colors } = useTheme();
  return (
    <Card radius="xl" padding="base">
      <VStack gap="sm">
        <HStack align="center" justify="between" gap="sm">
          <RatingStars value={review.rating} size="sm" />
          <AppText variant="micro" color="textTertiary">
            {formatRelativeDay(review.createdAt)}
          </AppText>
        </HStack>
        {review.title ? (
          <AppText variant="bodyStrong">{review.title}</AppText>
        ) : null}
        <AppText variant="body" color="textSecondary">
          {review.body}
        </AppText>
        <HStack align="center" justify="between" gap="sm">
          <HStack align="center" gap="xs">
            <AppText variant="micro" color="textSecondary">
              {review.mine ? 'You' : review.authorName}
            </AppText>
            {review.verified ? (
              <HStack align="center" gap="xxs">
                <Icon as={BadgeCheck} size="xs" tint={colors.success} />
                <AppText variant="micro" style={{ color: colors.success }}>
                  Verified buyer
                </AppText>
              </HStack>
            ) : null}
          </HStack>
          {review.mine && onEdit ? (
            <Pressable
              onPress={() => onEdit(review)}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel="Edit your review"
            >
              <AppText variant="micro" color="primary">
                Edit
              </AppText>
            </Pressable>
          ) : null}
        </HStack>
      </VStack>
    </Card>
  );
});

ReviewCard.displayName = 'ReviewCard';
