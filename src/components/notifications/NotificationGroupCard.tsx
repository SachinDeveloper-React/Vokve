import React, { Fragment, memo } from 'react';
import type { AppNotification } from '../../types/models';
import { Divider } from '../layout/Divider';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { NotificationRow } from './NotificationRow';

interface Props {
  /** The day this block covers — "Today", "Yesterday", "3 days ago". */
  title: string;
  notifications: AppNotification[];
  onPressNotification: (id: string) => void;
}

/**
 * A day's notifications, under its heading.
 *
 * One card per day rather than one long card with headings inside it: the gap
 * between cards is what tells the eye a day has ended, and it goes on working
 * when a day holds one notification or nine. The rules inside separate rows
 * within the same day, which is a weaker break — and that is the point.
 */
export const NotificationGroupCard = memo(
  ({ title, notifications, onPressNotification }: Props) => (
    <VStack gap="sm">
      <AppText variant="h3">{title}</AppText>

      <Card radius="xl" padding="base">
        <VStack>
          {notifications.map((notification, index) => (
            <Fragment key={notification.id}>
              {index > 0 ? <Divider /> : null}
              <NotificationRow
                notification={notification}
                onPress={onPressNotification}
              />
            </Fragment>
          ))}
        </VStack>
      </Card>
    </VStack>
  ),
);

NotificationGroupCard.displayName = 'NotificationGroupCard';
