/**
 * The notification centre is now a cache of the server's feed, so the checks
 * here are about the seam: a sync replaces the seed with the server's rows, a
 * read mark clears the bell at once and reaches the server after — but only
 * for rows the server knows about — and a sync that fails leaves the feed
 * the user was already reading.
 *
 * @format
 */

jest.mock('../src/services/api/endpoints', () => ({
  notificationApi: {
    list: jest.fn(),
    counts: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
}));

import {
  NOTIFICATIONS_STALE_AFTER_MS,
  useNotificationsStore,
} from '../src/stores/notificationsStore';
import type { AppNotification } from '../src/types/models';

const { notificationApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  notificationApi: {
    list: jest.Mock;
    counts: jest.Mock;
    markRead: jest.Mock;
    markAllRead: jest.Mock;
  };
};

const COUNTS = { all: 2, activity: 0, reward: 2, system: 0, unread: 1 };

const note = (id: string, read = false): AppNotification => ({
  id,
  topic: 'coins',
  title: `Note ${id}`,
  message: 'Something happened.',
  createdAt: new Date().toISOString(),
  read,
});

/** Lets the fire-and-forget server calls settle. */
const flush = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  useNotificationsStore.getState().reset();
  notificationApi.list.mockReset();
  notificationApi.counts.mockReset().mockResolvedValue(COUNTS);
  notificationApi.markRead.mockReset().mockResolvedValue({ ok: true });
  notificationApi.markAllRead.mockReset().mockResolvedValue({ ok: true });
});

test("a sync replaces the seeded feed with the server's newest page", async () => {
  notificationApi.list.mockResolvedValue({
    data: [note('s1'), note('s2', true)],
    nextCursor: null,
  });

  await useNotificationsStore.getState().hydrateFromServer();

  const state = useNotificationsStore.getState();
  expect(state.notifications.map(n => n.id)).toEqual(['s1', 's2']);
  expect(state.syncedAt).not.toBeNull();
  expect(state.isSyncing).toBe(false);
  expect(notificationApi.list).toHaveBeenCalledWith({ limit: 50 });
  // The chips and the bell read the server's totals, not the rows on hand.
  expect(state.counts).toEqual(COUNTS);
});

test('the bell and the chips prefer the server\'s counts, and reading moves the unread figure at once', async () => {
  notificationApi.list.mockResolvedValue({
    data: [note('s1'), note('s2', true)],
    nextCursor: null,
  });
  await useNotificationsStore.getState().hydrateFromServer();
  // Only one row on the device is unread, but the server says the same — and it is what counts.
  useNotificationsStore.setState({ counts: { ...COUNTS, unread: 7, all: 40 } });

  useNotificationsStore.getState().markRead('s1');
  await flush();
  expect(useNotificationsStore.getState().counts?.unread).toBe(6);

  useNotificationsStore.getState().markAllRead();
  await flush();
  expect(useNotificationsStore.getState().counts?.unread).toBe(0);
});

test('load more appends the next page and stops at the end', async () => {
  notificationApi.list
    .mockResolvedValueOnce({ data: [note('p1')], nextCursor: 'p1' })
    .mockResolvedValueOnce({ data: [note('p2')], nextCursor: null });
  await useNotificationsStore.getState().hydrateFromServer();

  await useNotificationsStore.getState().loadMore();
  expect(notificationApi.list).toHaveBeenLastCalledWith({ cursor: 'p1', limit: 50 });
  expect(useNotificationsStore.getState().notifications.map(n => n.id)).toEqual(['p1', 'p2']);

  await useNotificationsStore.getState().loadMore();
  expect(notificationApi.list).toHaveBeenCalledTimes(2); // the end: nothing more asked for
});

test('a failed sync keeps whatever was on the device', async () => {
  useNotificationsStore.setState({ notifications: [note('kept')] });
  notificationApi.list.mockRejectedValue(new Error('Network Error'));

  await useNotificationsStore.getState().hydrateFromServer();

  const state = useNotificationsStore.getState();
  expect(state.notifications.map(n => n.id)).toEqual(['kept']);
  expect(state.syncedAt).toBeNull();
  expect(state.isSyncing).toBe(false);
});

test('refreshIfStale leaves a fresh feed alone and fetches a stale one', async () => {
  notificationApi.list.mockResolvedValue({ data: [], nextCursor: null });

  useNotificationsStore.setState({ syncedAt: new Date().toISOString() });
  await useNotificationsStore.getState().refreshIfStale();
  expect(notificationApi.list).not.toHaveBeenCalled();

  useNotificationsStore.setState({
    syncedAt: new Date(
      Date.now() - NOTIFICATIONS_STALE_AFTER_MS - 1,
    ).toISOString(),
  });
  await useNotificationsStore.getState().refreshIfStale();
  expect(notificationApi.list).toHaveBeenCalledTimes(1);
});

test('reading a synced row clears it at once and tells the server', async () => {
  useNotificationsStore.setState({
    notifications: [note('a'), note('b')],
    syncedAt: new Date().toISOString(),
  });

  useNotificationsStore.getState().markRead('a');
  await flush();

  expect(useNotificationsStore.getState().notifications[0].read).toBe(true);
  expect(notificationApi.markRead).toHaveBeenCalledWith('a');

  // Already read: nothing to say again.
  useNotificationsStore.getState().markRead('a');
  await flush();
  expect(notificationApi.markRead).toHaveBeenCalledTimes(1);
});

test('reading a seeded row never reaches the server, which has no such row', async () => {
  useNotificationsStore.setState({
    notifications: [note('seed-1')],
    syncedAt: null,
  });

  useNotificationsStore.getState().markRead('seed-1');
  await flush();

  expect(useNotificationsStore.getState().notifications[0].read).toBe(true);
  expect(notificationApi.markRead).not.toHaveBeenCalled();
});

test('a read mark the server refuses stays read on the device', async () => {
  useNotificationsStore.setState({
    notifications: [note('a')],
    syncedAt: new Date().toISOString(),
  });
  notificationApi.markRead.mockRejectedValue(new Error('Network Error'));

  useNotificationsStore.getState().markRead('a');
  await flush();

  expect(useNotificationsStore.getState().notifications[0].read).toBe(true);
});

test('read-all clears every row and makes one call, and none when nothing was unread', async () => {
  useNotificationsStore.setState({
    notifications: [note('a'), note('b', true), note('c')],
    syncedAt: new Date().toISOString(),
  });

  useNotificationsStore.getState().markAllRead();
  await flush();

  expect(
    useNotificationsStore.getState().notifications.every(n => n.read),
  ).toBe(true);
  expect(notificationApi.markAllRead).toHaveBeenCalledTimes(1);

  useNotificationsStore.getState().markAllRead();
  await flush();
  expect(notificationApi.markAllRead).toHaveBeenCalledTimes(1);
});
