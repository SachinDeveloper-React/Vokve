import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { seedNotifications } from '../constants/seedData';
import type {
  AppNotification,
  NotificationCategory,
  NotificationTopic,
} from '../types/models';
import { toIsoDate, type IsoDate } from '../utils/date';
import { formatRelativeDay } from '../utils/format';
import { mmkvStorage } from './index';

/**
 * Which filter each topic answers to.
 *
 * Exhaustive by type: adding a `NotificationTopic` without filing it here is a
 * compile error rather than a notification that arrives under no chip and can
 * only be found by turning the filter off.
 */
export const NOTIFICATION_CATEGORY: Record<
  NotificationTopic,
  NotificationCategory
> = {
  steps: 'activity',
  workout: 'activity',
  streak: 'activity',
  hydration: 'activity',
  coins: 'reward',
  challenge: 'reward',
  reward: 'reward',
  health: 'system',
  system: 'system',
};

/** The filter row's states. `all` is a view of the list, not a category. */
export type NotificationFilter = NotificationCategory | 'all';

interface NotificationsState {
  /** Newest first. */
  notifications: AppNotification[];

  /** Marks one row read. A no-op if it is read already or has gone. */
  markRead: (id: string) => void;
  markAllRead: () => void;
  reset: () => void;
}

/**
 * The notification centre's feed.
 *
 * Read state lives here rather than on the screen so the bell's unread dot and
 * the list agree: tapping a row has to clear the dot on Home too, and a screen
 * that owned the flag would leave the two telling different stories until the
 * next launch.
 */
export const useNotificationsStore = create<NotificationsState>()(
  persist(
    set => ({
      notifications: seedNotifications,

      markRead: id =>
        set(state => {
          const target = state.notifications.find(entry => entry.id === id);
          if (target === undefined || target.read) {
            return state;
          }
          return {
            notifications: state.notifications.map(entry =>
              entry.id === id ? { ...entry, read: true } : entry,
            ),
          };
        }),

      markAllRead: () =>
        set(state =>
          state.notifications.some(entry => !entry.read)
            ? {
                notifications: state.notifications.map(entry =>
                  entry.read ? entry : { ...entry, read: true },
                ),
              }
            : state,
        ),

      reset: () => set({ notifications: seedNotifications }),
    }),
    {
      name: 'vokve.notifications',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
    },
  ),
);

export const useNotifications = () =>
  useNotificationsStore(s => s.notifications);

/**
 * Both of these return a primitive, so the selector can derive them on every
 * read: a fresh number or boolean still compares equal to the last one, where
 * a derived array or object would re-render the subscriber forever.
 */
export const useUnreadNotificationCount = () =>
  useNotificationsStore(
    s => s.notifications.filter(entry => !entry.read).length,
  );

export const useHasUnreadNotifications = () =>
  useNotificationsStore(s => s.notifications.some(entry => !entry.read));

export type NotificationCounts = Record<NotificationFilter, number>;

function matchesFilter(
  notification: AppNotification,
  filter: NotificationFilter,
): boolean {
  return (
    filter === 'all' || NOTIFICATION_CATEGORY[notification.topic] === filter
  );
}

function countByFilter(notifications: AppNotification[]): NotificationCounts {
  const counts: NotificationCounts = {
    all: notifications.length,
    activity: 0,
    reward: 0,
    system: 0,
  };

  for (const entry of notifications) {
    counts[NOTIFICATION_CATEGORY[entry.topic]] += 1;
  }

  return counts;
}

/**
 * How many notifications each chip in the filter row stands for — the total in
 * that category, not the unread part of it. The badge is there to say how much
 * is behind the chip before it is tapped; a count that shrank as the user read
 * rows would make an empty-looking filter out of a list that is still full.
 *
 * Memoised over the feed rather than derived in the selector: a fresh object
 * never compares equal to the last one, and the subscriber would re-render on
 * every store read.
 */
export const useNotificationCounts = (): NotificationCounts => {
  const notifications = useNotifications();
  return useMemo(() => countByFilter(notifications), [notifications]);
};

export interface NotificationGroup {
  /** The day itself, and what keeps two "12 Sep"s a year apart separate. */
  date: IsoDate;
  /** The heading — "Today", "Yesterday", "3 days ago", "12 Sep". */
  title: string;
  notifications: AppNotification[];
}

function groupByDay(notifications: AppNotification[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  const byDate = new Map<IsoDate, NotificationGroup>();

  for (const entry of notifications) {
    const at = new Date(entry.createdAt);
    if (Number.isNaN(at.getTime())) {
      continue;
    }

    const date = toIsoDate(at);
    let group = byDate.get(date);

    if (group === undefined) {
      group = { date, title: formatRelativeDay(entry.createdAt), notifications: [] };
      byDate.set(date, group);
      groups.push(group);
    }

    group.notifications.push(entry);
  }

  return groups;
}

/**
 * The feed a filter is showing, newest first and split into day sections.
 *
 * Sorted here rather than trusting the order the rows arrived in: the list is
 * persisted and appended to, and one row out of sequence would file itself
 * under a second heading for a day that already has one.
 */
export const useNotificationGroups = (
  filter: NotificationFilter,
): NotificationGroup[] => {
  const notifications = useNotifications();

  return useMemo(() => {
    const visible = notifications
      .filter(entry => matchesFilter(entry, filter))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return groupByDay(visible);
  }, [filter, notifications]);
};
