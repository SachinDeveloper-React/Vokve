/**
 * Keeping the OS in step with the plan (RULES Y6).
 *
 * The scheduler is the only thing joining the store to the device, so what
 * matters here is what it carries across and what it refuses to: an edit has
 * to reach the OS, quiet hours and the water goal have to travel with it,
 * health notifications switched off have to stop it, and an unrelated store
 * write must not cost a sync.
 *
 * @format
 */

import {
  resetReminderScheduler,
  resyncReminders,
  startReminderScheduler,
} from '../src/services/reminderScheduler';
import { useNotificationSettingsStore } from '../src/stores/notificationSettingsStore';
import { useRemindersStore } from '../src/stores/remindersStore';
import { useSettingsStore } from '../src/stores/settingsStore';
import type { HydrationReminderPlan } from '../src/types/models';

jest.mock('../src/services/notifications', () => ({
  syncHydrationReminders: jest.fn(async () => ({
    scheduled: 2,
    allowed: true,
    exact: true,
  })),
}));

const { syncHydrationReminders } = jest.requireMock(
  '../src/services/notifications',
) as { syncHydrationReminders: jest.Mock };

const PLAN: HydrationReminderPlan = {
  enabled: true,
  sound: 'water_drop',
  vibration: true,
  repeatDays: [0, 1, 2, 3, 4, 5, 6],
  reminders: [{ id: 'a', time: '10:00', slot: 'morning', enabled: true }],
};

const QUIET = { enabled: true, start: '22:00', end: '07:00' };

/** The plan the last sync was asked to schedule. */
const lastPlan = () => syncHydrationReminders.mock.calls.at(-1)?.[0] ?? null;
const lastOptions = () => syncHydrationReminders.mock.calls.at(-1)?.[1];

beforeEach(() => {
  syncHydrationReminders.mockClear();
  resetReminderScheduler();
  useRemindersStore.setState({ plan: PLAN });
  useSettingsStore.setState({ dailyWaterGoalMl: 2500 });
  useNotificationSettingsStore.setState({
    categories: {
      activity: true,
      coins: true,
      challenges: true,
      orders: true,
      offers: true,
      announcements: true,
      referrals: true,
      health: true,
    },
    quietHours: QUIET,
  });
});

afterEach(() => {
  resetReminderScheduler();
});

describe('what the scheduler carries to the OS', () => {
  test('the plan, the quiet window and the goal travel together', async () => {
    await resyncReminders();

    expect(lastPlan()).toEqual(PLAN);
    expect(lastOptions()).toMatchObject({ quietHours: QUIET, goalMl: 2500 });
  });

  test('health notifications off schedule nothing, and the plan is still kept', async () => {
    useNotificationSettingsStore.setState(state => ({
      categories: { ...state.categories, health: false },
    }));

    await resyncReminders();

    // Null, not an empty plan: the member's times are untouched and come
    // back the moment they allow health notifications.
    expect(lastPlan()).toBeNull();
    expect(useRemindersStore.getState().plan).toEqual(PLAN);
  });

  test('a plan the server has not answered for yet schedules nothing', async () => {
    useRemindersStore.setState({ plan: null });

    await resyncReminders();

    expect(lastPlan()).toBeNull();
  });

  test('a second sync with nothing changed does no work, and `force` does it anyway', async () => {
    await resyncReminders();
    expect(syncHydrationReminders).toHaveBeenCalledTimes(1);

    await resyncReminders();
    expect(syncHydrationReminders).toHaveBeenCalledTimes(1);

    // The permission may have been withdrawn in the system settings, where
    // nothing in the app would know it changed.
    await resyncReminders({ force: true });
    expect(syncHydrationReminders).toHaveBeenCalledTimes(2);
  });

  test('a failed sync is not remembered as done, so the next attempt tries again', async () => {
    syncHydrationReminders.mockRejectedValueOnce(new Error('no native module'));

    expect(await resyncReminders()).toBeNull();
    await resyncReminders();

    expect(syncHydrationReminders).toHaveBeenCalledTimes(2);
  });
});

describe('what it watches', () => {
  test('an edit to the plan reaches the OS, once, after the burst has settled', async () => {
    jest.useFakeTimers();
    const stop = startReminderScheduler();
    try {
      // The mount's own sync.
      jest.runOnlyPendingTimers();
      await Promise.resolve();
      syncHydrationReminders.mockClear();

      useRemindersStore.setState({
        plan: {
          ...PLAN,
          reminders: [...PLAN.reminders, { id: 'b', time: '13:00', slot: 'afternoon', enabled: true }],
        },
      });
      useRemindersStore.setState(state => ({ plan: state.plan }));

      // Nothing yet: two writes a moment apart are one edit.
      expect(syncHydrationReminders).not.toHaveBeenCalled();

      jest.runOnlyPendingTimers();
      await Promise.resolve();

      expect(syncHydrationReminders).toHaveBeenCalledTimes(1);
      expect(lastPlan().reminders).toHaveLength(2);
    } finally {
      stop();
      jest.useRealTimers();
    }
  });

  test('a store write that changes nothing the schedule depends on costs no sync', async () => {
    jest.useFakeTimers();
    const stop = startReminderScheduler();
    try {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
      syncHydrationReminders.mockClear();

      // The sync state moves constantly; the schedule does not depend on it.
      useRemindersStore.setState({ isSyncing: true, syncError: null });
      jest.runOnlyPendingTimers();
      await Promise.resolve();

      expect(syncHydrationReminders).not.toHaveBeenCalled();
    } finally {
      stop();
      jest.useRealTimers();
    }
  });

  test('stopping it stops the watching', async () => {
    jest.useFakeTimers();
    const stop = startReminderScheduler();
    jest.runOnlyPendingTimers();
    await Promise.resolve();
    syncHydrationReminders.mockClear();
    stop();

    useSettingsStore.setState({ dailyWaterGoalMl: 3000 });
    jest.runOnlyPendingTimers();
    await Promise.resolve();

    expect(syncHydrationReminders).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
