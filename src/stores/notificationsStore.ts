import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { notificationApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type {
  AppNotification,
  NotificationCategory,
  NotificationCountsSummary,
  NotificationTopic,
} from '../types/models';
import { toIsoDate, type IsoDate } from '../utils/date';
import { formatRelativeDay } from '../utils/format';
import { logger } from '../utils/logger';
import { mmkvStorage } from './index';

/**
 * How much of the feed is kept on the device. The centre shows what happened
 * lately, not an archive: fifty rows is a couple of weeks of a busy user, and
 * anything older lives on the server.
 */
const MAX_FEED_ENTRIES = 50;

/** How old a synced feed may be before opening the centre fetches it again. */
export const NOTIFICATIONS_STALE_AFTER_MS = 60_000;

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
  /** Newest first: the first page, plus any pages scrolled to. */
  notifications: AppNotification[];
  /** The server has rows beyond the last one here. */
  nextCursor: string | null;
  /**
   * The server's totals per chip and its unread figure (`GET
   * /notifications/counts`). The feed here is paged, so counting the rows
   * on the device would undercount; null until the first sync, when the
   * hooks fall back to counting what is here.
   */
  counts: NotificationCountsSummary | null;
  /** When the server last confirmed the feed; null until it first has. */
  syncedAt: string | null;
  isSyncing: boolean;
  /** Why the last sync failed; cleared by the next one that succeeds. */
  syncError: string | null;
  isLoadingMore: boolean;

  /**
   * Replaces the feed with the server's newest page. The server writes the
   * rows (BACKEND §6.14); this store is its cache, and the read marks below
   * are sent back so the bell agrees across devices. A failed sync keeps the
   * cached rows and is logged, not thrown — every caller's answer to it is
   * to show what it has.
   */
  hydrateFromServer: () => Promise<void>;
  /** `hydrateFromServer`, unless the feed is fresher than `NOTIFICATIONS_STALE_AFTER_MS`. */
  refreshIfStale: () => Promise<void>;
  /** Fetches the next page and appends it. A no-op at the end or mid-flight. */
  loadMore: () => Promise<void>;

  /**
   * Marks one row read. A no-op if it is read already or has gone. The dot
   * clears at once; the server is told after, and a failure is logged rather
   * than undone — a row the user has read is read, whatever the network says.
   */
  markRead: (id: string) => void;
  markAllRead: () => void;
  reset: () => void;
}

/** The feed before the first sync: nothing the server has not sent. */
const EMPTY_FEED = {
  notifications: [] as AppNotification[],
  nextCursor: null,
  counts: null,
  syncedAt: null,
} satisfies Partial<NotificationsState>;

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
    (set, get) => ({
      ...EMPTY_FEED,
      isSyncing: false,
      syncError: null,
      isLoadingMore: false,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true });
        try {
          const [page, counts] = await Promise.all([
            notificationApi.list({ limit: MAX_FEED_ENTRIES }),
            notificationApi.counts(),
          ]);
          set({
            notifications: page.data,
            nextCursor: page.nextCursor,
            counts,
            syncedAt: new Date().toISOString(),
            isSyncing: false,
            syncError: null,
          });
        } catch (error) {
          const apiError = toApiError(error);
          logger.warn('notificationsStore', 'Feed sync failed', apiError);
          set({ isSyncing: false, syncError: apiError.message });
        }
      },

      refreshIfStale: async () => {
        const { syncedAt, isSyncing, hydrateFromServer } = get();
        if (isSyncing) {
          return;
        }
        const age = syncedAt
          ? Date.now() - new Date(syncedAt).getTime()
          : Infinity;
        if (age < NOTIFICATIONS_STALE_AFTER_MS) {
          return;
        }
        await hydrateFromServer();
      },

      loadMore: async () => {
        const { nextCursor, isLoadingMore, isSyncing } = get();
        if (nextCursor === null || isLoadingMore || isSyncing) {
          return;
        }
        set({ isLoadingMore: true });
        try {
          const page = await notificationApi.list({
            cursor: nextCursor,
            limit: MAX_FEED_ENTRIES,
          });
          set(state => ({
            notifications: [...state.notifications, ...page.data],
            nextCursor: page.nextCursor,
            isLoadingMore: false,
          }));
        } catch (error) {
          logger.warn(
            'notificationsStore',
            'Could not load more of the feed',
            toApiError(error),
          );
          set({ isLoadingMore: false });
        }
      },

      markRead: id => {
        const target = get().notifications.find(entry => entry.id === id);
        if (target === undefined || target.read) {
          return;
        }
        set(state => ({
          notifications: state.notifications.map(entry =>
            entry.id === id ? { ...entry, read: true } : entry,
          ),
          // The bell follows the server's figure once synced; one fewer now,
          // rather than after a round trip.
          counts: state.counts && {
            ...state.counts,
            unread: Math.max(0, state.counts.unread - 1),
          },
        }));
        notificationApi.markRead(id).catch(error => {
          logger.warn(
            'notificationsStore',
            'Could not mark read on the server',
            toApiError(error),
          );
        });
      },

      markAllRead: () => {
        // Unread rows on the device, or unread the server counts on pages
        // not loaded here — either is something to clear.
        const { notifications, counts } = get();
        const anyUnread =
          notifications.some(entry => !entry.read) ||
          (counts !== null && counts.unread > 0);
        if (!anyUnread) {
          return;
        }
        set(state => ({
          notifications: state.notifications.map(entry =>
            entry.read ? entry : { ...entry, read: true },
          ),
          counts: state.counts && { ...state.counts, unread: 0 },
        }));
        notificationApi.markAllRead().catch(error => {
          logger.warn(
            'notificationsStore',
            'Could not mark all read on the server',
            toApiError(error),
          );
        });
      },

      reset: () =>
        set({
          ...EMPTY_FEED,
          isSyncing: false,
          syncError: null,
          isLoadingMore: false,
        }),
    }),
    {
      name: 'vokve.notifications',
      storage: createJSONStorage(() => mmkvStorage),
      // v2: the placeholder feed is gone. A stored feed that never synced was
      // that placeholder, and is dropped; a synced one is the server's.
      version: 2,
      migrate: persisted => {
        const stored = persisted as Partial<NotificationsState> | null;
        return stored?.syncedAt ? stored : EMPTY_FEED;
      },
      partialize: state => ({
        notifications: state.notifications,
        nextCursor: state.nextCursor,
        counts: state.counts,
        syncedAt: state.syncedAt,
      }),
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
    s =>
      s.counts?.unread ?? s.notifications.filter(entry => !entry.read).length,
  );

export const useHasUnreadNotifications = () =>
  useNotificationsStore(s =>
    s.counts ? s.counts.unread > 0 : s.notifications.some(entry => !entry.read),
  );

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
  const fromServer = useNotificationsStore(s => s.counts);
  return useMemo(
    () =>
      fromServer
        ? {
            all: fromServer.all,
            activity: fromServer.activity,
            reward: fromServer.reward,
            system: fromServer.system,
          }
        : countByFilter(notifications),
    [fromServer, notifications],
  );
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
      group = {
        date,
        title: formatRelativeDay(entry.createdAt),
        notifications: [],
      };
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
