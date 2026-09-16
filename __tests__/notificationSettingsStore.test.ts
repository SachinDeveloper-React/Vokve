/**
 * Notification settings are consent the server enforces, so the checks here
 * are about the seam: a sync replaces the switches with the server's, a flip
 * shows at once and is sent as a patch of only what changed, a refused flip
 * goes back to what the server holds and says why, and nothing is sent for
 * a store that has never synced — there is no record to patch yet.
 *
 * @format
 */

jest.mock('../src/services/api/endpoints', () => ({
  notificationPreferencesApi: { get: jest.fn(), update: jest.fn() },
}));

import { useNotificationSettingsStore } from '../src/stores/notificationSettingsStore';
import type { NotificationPreferences } from '../src/types/models';

const { notificationPreferencesApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as { notificationPreferencesApi: { get: jest.Mock; update: jest.Mock } };

const SERVER: NotificationPreferences = {
  categories: {
    activity: true,
    coins: false,
    challenges: true,
    orders: true,
    offers: false,
    announcements: true,
    referrals: true,
    health: true,
  },
  quietHours: { enabled: false, start: '23:00', end: '06:30' },
  sms: false,
  email: true,
};

const flush = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  useNotificationSettingsStore.getState().reset();
  notificationPreferencesApi.get.mockReset().mockResolvedValue(SERVER);
  notificationPreferencesApi.update.mockReset();
});

test("a sync replaces the device's switches with the server's", async () => {
  await useNotificationSettingsStore.getState().hydrateFromServer();

  const state = useNotificationSettingsStore.getState();
  expect(state.categories).toEqual(SERVER.categories);
  expect(state.quietHours).toEqual(SERVER.quietHours);
  expect(state).toMatchObject({ sms: false, email: true, isSyncing: false });
  expect(state.syncedAt).not.toBeNull();
});

test('a flip shows at once and is sent as a patch of only what changed', async () => {
  await useNotificationSettingsStore.getState().hydrateFromServer();
  notificationPreferencesApi.update.mockImplementation(async patch => ({
    ...SERVER,
    categories: { ...SERVER.categories, ...patch.categories },
  }));

  useNotificationSettingsStore.getState().setCategory('coins', true);

  expect(useNotificationSettingsStore.getState().categories.coins).toBe(true); // before the answer
  await flush();
  expect(notificationPreferencesApi.update).toHaveBeenCalledWith({
    categories: { coins: true },
  });
  expect(useNotificationSettingsStore.getState().categories.coins).toBe(true);
});

test('Enable All sends only the switches that were off, and nothing when none were', async () => {
  await useNotificationSettingsStore.getState().hydrateFromServer();
  notificationPreferencesApi.update.mockImplementation(async patch => ({
    ...SERVER,
    categories: { ...SERVER.categories, ...patch.categories },
  }));

  useNotificationSettingsStore.getState().enableAll();
  await flush();

  expect(notificationPreferencesApi.update).toHaveBeenCalledWith({
    categories: { coins: true, offers: true },
  });

  useNotificationSettingsStore.getState().enableAll();
  await flush();
  expect(notificationPreferencesApi.update).toHaveBeenCalledTimes(1);
});

test('a refused flip goes back to what the server holds, and says why', async () => {
  await useNotificationSettingsStore.getState().hydrateFromServer();
  notificationPreferencesApi.update.mockRejectedValue(
    new Error('Network Error'),
  );

  useNotificationSettingsStore.getState().setSms(true);
  expect(useNotificationSettingsStore.getState().sms).toBe(true);
  await flush();

  const state = useNotificationSettingsStore.getState();
  expect(state.sms).toBe(false);
  expect(state.saveError).toEqual(expect.any(String));

  state.clearSaveError();
  expect(useNotificationSettingsStore.getState().saveError).toBeNull();
});

test("the server's answer wins over the optimistic value — a clamp it applied is what shows", async () => {
  await useNotificationSettingsStore.getState().hydrateFromServer();
  notificationPreferencesApi.update.mockResolvedValue({
    ...SERVER,
    quietHours: { enabled: true, start: '22:00', end: '07:00' },
  });

  useNotificationSettingsStore.getState().setQuietHours({ start: '22:00' });
  await flush();

  expect(notificationPreferencesApi.update).toHaveBeenCalledWith({
    quietHours: { start: '22:00' },
  });
  expect(useNotificationSettingsStore.getState().quietHours).toEqual({
    enabled: true,
    start: '22:00',
    end: '07:00',
  });
});

test('before the first sync a flip stays on the device and nothing is sent', async () => {
  useNotificationSettingsStore.getState().setEmail(true);
  await flush();

  expect(useNotificationSettingsStore.getState().email).toBe(true);
  expect(notificationPreferencesApi.update).not.toHaveBeenCalled();
});
