import React, { Fragment, memo } from 'react';
import { useTheme } from '../../theme';
import {
  NOTIFICATION_CATEGORIES,
  type CategorySwitches,
  type NotificationCategoryKey,
} from '../../stores/notificationSettingsStore';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { NotificationCategoryRow } from './NotificationCategoryRow';

interface Props {
  categories: CategorySwitches;
  /** Disabled once everything is already on, so the link cannot lie. */
  canEnableAll: boolean;
  onChange: (category: NotificationCategoryKey, value: boolean) => void;
  onPressEnableAll: () => void;
}

/**
 * The eight categories, each with its own switch.
 *
 * "Enable All" and no "Disable All", deliberately. Turning everything on is
 * one decision a user might reasonably make in one tap; turning everything off
 * is eight decisions they would rather make one at a time — and a single tap
 * that silences an order's delivery updates along with a promotion is how
 * people miss parcels.
 */
export const NotificationCategoriesCard = memo(
  ({ categories, canEnableAll, onChange, onPressEnableAll }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="xl" padding="base">
        <VStack gap="xs">
          <HStack align="center" justify="between" gap="sm">
            <AppText variant="h3" numberOfLines={1}>
              Notification Categories
            </AppText>

            <Pressable
              onPress={onPressEnableAll}
              disabled={!canEnableAll}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel="Enable all notification categories"
              accessibilityState={{ disabled: !canEnableAll }}
            >
              <AppText
                variant="micro"
                style={{
                  color: canEnableAll
                    ? colors.brandAccent
                    : colors.textTertiary,
                }}
              >
                Enable All
              </AppText>
            </Pressable>
          </HStack>

          <VStack>
            {NOTIFICATION_CATEGORIES.map((category, index) => (
              <Fragment key={category}>
                {index > 0 ? <Divider /> : null}
                <NotificationCategoryRow
                  category={category}
                  enabled={categories[category]}
                  onChange={onChange}
                />
              </Fragment>
            ))}
          </VStack>
        </VStack>
      </Card>
    );
  },
);

NotificationCategoriesCard.displayName = 'NotificationCategoriesCard';
