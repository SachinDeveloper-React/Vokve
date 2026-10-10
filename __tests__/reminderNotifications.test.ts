/**
 * Putting the plan on the device (RULES Y5, Y6).
 *
 * What the planner decides is checked in `reminderSchedule.test`; this is
 * about the handover to the OS and to the server: the channel a sound and a
 * vibration setting come to, the alarm type, the sound on each platform, and
 * who the server is told is doing the reminding — which, got wrong in either
 * direction, means a reminder twice or not at all.
 *
 * @format
 */

import { Platform } from 'react-native';
import notifee, {
  AlarmType,
  AndroidNotificationSetting,
  AuthorizationStatus,
  RepeatFrequency,
} from '@notifee/react-native';
import {
  cancelHydrationReminders,
  previewReminderSound,
  reminderChannelId,
  syncHydrationReminders,
  VIBRATION_PATTERN,
} from '../src/services/notifications';
import { ALARM_ID_PREFIX } from '../src/services/reminderSchedule';
import type { HydrationReminderPlan } from '../src/types/models';

jest.mock('../src/services/device', () => ({
  getDeviceId: () => 'dev-1',
}));

jest.mock('../src/services/api/endpoints', () => ({
  deviceApi: { setLocalReminders: jest.fn(async () => ({ ok: true })) },
}));

const { deviceApi } = jest.requireMock('../src/services/api/endpoints') as {
  deviceApi: { setLocalReminders: jest.Mock };
};

const api = notifee as unknown as Record<string, jest.Mock>;

/** A Wednesday, 08:00 local. */
const NOW = new Date(2026, 9, 14, 8, 0, 0, 0);

const PLAN: HydrationReminderPlan = {
  enabled: true,
  sound: 'water_drop',
  vibration: true,
  repeatDays: [0, 1, 2, 3, 4, 5, 6],
  reminders: [
    { id: 'a', time: '10:00', slot: 'morning', enabled: true },
    { id: 'b', time: '13:00', slot: 'afternoon', enabled: true },
  ],
};

const allowed = (
  status = AuthorizationStatus.AUTHORIZED,
  alarm = AndroidNotificationSetting.ENABLED,
) => {
  api.getNotificationSettings.mockResolvedValue({
    authorizationStatus: status,
    android: { alarm },
    ios: {},
  });
};

beforeEach(() => {
  Object.values(api).forEach(value => {
    if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
  });
  deviceApi.setLocalReminders.mockClear();
  api.getTriggerNotificationIds.mockResolvedValue([]);
  api.getChannels.mockResolvedValue([]);
  api.createTriggerNotification.mockImplementation(async () => 'id');
  allowed();
  Platform.OS = 'android';
});

afterAll(() => {
  Platform.OS = 'ios';
});

/** The notification and trigger of the nth scheduled alarm. */
const call = (n = 0) => {
  const [notification, trigger] = api.createTriggerNotification.mock.calls[n];
  return { notification, trigger };
};

describe('scheduling the plan', () => {
  test('schedules one alarm per time, exact and repeating daily', async () => {
    const status = await syncHydrationReminders(PLAN, { now: NOW, goalMl: 2500 });

    expect(status).toEqual({ scheduled: 2, allowed: true, exact: true });
    expect(api.createTriggerNotification).toHaveBeenCalledTimes(2);

    const { notification, trigger } = call(0);
    expect(notification.id).toBe(`${ALARM_ID_PREFIX}10:00`);
    expect(trigger.repeatFrequency).toBe(RepeatFrequency.DAILY);
    // AlarmManager, exact, and allowed to wake a dozing phone — otherwise a
    // reminder for 10:00 arrives whenever Android next feels like it.
    expect(trigger.alarmManager).toEqual({
      type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE,
    });
  });

  test('says the goal, so the reminder is worth reading', async () => {
    await syncHydrationReminders(PLAN, { now: NOW, goalMl: 2500 });

    expect(call(0).notification.body).toContain('2.5 L');
  });

  test('clears what it scheduled last time, and nothing else', async () => {
    api.getTriggerNotificationIds.mockResolvedValue([
      `${ALARM_ID_PREFIX}07:00`,
      'some.other.feature.alarm',
    ]);

    await syncHydrationReminders(PLAN, { now: NOW });

    expect(api.cancelTriggerNotifications).toHaveBeenCalledWith([
      `${ALARM_ID_PREFIX}07:00`,
    ]);
  });

  test('falls back to an inexact alarm where the phone will not allow an exact one', async () => {
    allowed(AuthorizationStatus.AUTHORIZED, AndroidNotificationSetting.DISABLED);

    const status = await syncHydrationReminders(PLAN, { now: NOW });

    // Still scheduled — a reminder within a few minutes beats none — and the
    // screen is told so it can offer the permission.
    expect(status).toMatchObject({ scheduled: 2, exact: false });
    expect(call(0).trigger.alarmManager).toEqual({
      type: AlarmType.SET_AND_ALLOW_WHILE_IDLE,
    });
  });

  test('one alarm the OS refuses does not lose the rest', async () => {
    api.createTriggerNotification
      .mockRejectedValueOnce(new Error('no'))
      .mockImplementation(async () => 'id');

    expect(await syncHydrationReminders(PLAN, { now: NOW })).toMatchObject({
      scheduled: 1,
    });
  });
});

describe('what we send notifee is what notifee accepts', () => {
  /**
   * Notifee's real validator, not the jest double.
   *
   * The double accepts anything, which is exactly how a channel with an
   * invalid vibration pattern shipped: every test passed, and the device
   * threw inside `createChannel` and scheduled nothing. So the channel and
   * notification objects the app actually builds are captured from the
   * calls and run through the real validators here.
   */
  const validateChannel = jest.requireActual(
    '@notifee/react-native/dist/validators/validateAndroidChannel',
  ).default;
  const validateNotification = jest.requireActual(
    '@notifee/react-native/dist/validators/validateAndroidNotification',
  ).default;

  test('every channel the app creates is valid', async () => {
    for (const sound of ['default', 'water_drop', 'chime', 'bell', 'silent']) {
      for (const vibration of [true, false]) {
        api.createChannel.mockClear();
        await syncHydrationReminders({ ...PLAN, sound, vibration }, { now: NOW });

        const channel = api.createChannel.mock.calls[0][0];
        expect(() => validateChannel(channel)).not.toThrow();
      }
    }
  });

  test('every notification the app schedules is valid', async () => {
    await syncHydrationReminders(PLAN, { now: NOW });

    const notification = call(0).notification;
    expect(() => validateNotification(notification.android)).not.toThrow();
  });

  test('the preview’s channel and notification are valid too', async () => {
    await previewReminderSound('bell', true);

    expect(() => validateChannel(api.createChannel.mock.calls[0][0])).not.toThrow();
    const preview = api.displayNotification.mock.calls[0][0];
    expect(() => validateNotification(preview.android)).not.toThrow();
  });
});

describe('the vibration pattern', () => {
  /**
   * Notifee's own rule, copied from `validators/validate.ts`: an even number
   * of values, every one of them strictly above zero.
   *
   * Held here because breaking it is not a typo that shows up anywhere
   * useful — `createChannel` throws, which took the whole sync down with it
   * and left every reminder unscheduled with nothing on screen to say so.
   * Android's own convention starts a pattern with 0, which makes this an
   * easy mistake to make twice.
   */
  const satisfiesNotifee = (pattern: number[]) =>
    pattern.length % 2 === 0 &&
    pattern.every(ms => typeof ms === 'number' && ms > 0);

  test('is one notifee will accept', () => {
    expect(satisfiesNotifee(VIBRATION_PATTERN)).toBe(true);
  });

  test('and the rule really does reject Android’s own leading zero', () => {
    // Guards the guard: a check that passed everything would prove nothing.
    expect(satisfiesNotifee([0, 250, 250, 250])).toBe(false);
    expect(satisfiesNotifee([250, 250, 250])).toBe(false);
  });
});

describe('the sound and the vibration', () => {
  test('each sound and vibration pair gets its own channel, since Android freezes them', async () => {
    await syncHydrationReminders(PLAN, { now: NOW });

    expect(api.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: reminderChannelId('water_drop', true),
        sound: 'water_drop',
        vibration: true,
        vibrationPattern: expect.any(Array),
      }),
    );
    expect(call(0).notification.android.channelId).toBe(
      reminderChannelId('water_drop', true),
    );
  });

  test('vibration off is a different channel, with no pattern', async () => {
    await syncHydrationReminders({ ...PLAN, vibration: false }, { now: NOW });

    expect(api.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: reminderChannelId('water_drop', false),
        vibration: false,
        vibrationPattern: undefined,
      }),
    );
  });

  test('the default sound is the phone’s own, and silent is no sound at all', async () => {
    await syncHydrationReminders({ ...PLAN, sound: 'default' }, { now: NOW });
    expect(api.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ sound: 'default' }),
    );

    api.createChannel.mockClear();
    await syncHydrationReminders({ ...PLAN, sound: 'silent' }, { now: NOW });
    expect(api.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ sound: undefined, vibration: true }),
    );
  });

  test('a sound this build has no audio for rings the phone’s own rather than nothing', async () => {
    // The server may offer a sound a release of the app does not carry yet.
    await syncHydrationReminders({ ...PLAN, sound: 'air_horn' }, { now: NOW });

    expect(api.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ sound: 'default' }),
    );
  });

  test('the old channels are cleared, so Android’s settings do not fill up', async () => {
    api.getChannels.mockResolvedValue([
      { id: reminderChannelId('chime', true) },
      { id: reminderChannelId('water_drop', true) },
      { id: 'vokve.default' },
    ]);

    await syncHydrationReminders(PLAN, { now: NOW });

    expect(api.deleteChannel).toHaveBeenCalledTimes(1);
    expect(api.deleteChannel).toHaveBeenCalledWith(reminderChannelId('chime', true));
  });

  test('a channel the phone refuses falls back, rather than losing every reminder', async () => {
    api.createChannel.mockRejectedValueOnce(new Error('bad vibrationPattern'));

    const status = await syncHydrationReminders(PLAN, { now: NOW });

    // The sound and the buzz are how a reminder arrives, not whether it
    // does. One refused setting must not cost the user the whole plan.
    expect(status).toMatchObject({ scheduled: 2 });
    expect(api.createChannel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'vokve.hydration.fallback' }),
    );
    expect(call(0).notification.android.channelId).toBe('vokve.hydration.fallback');
  });

  test('the fallback channel is not then deleted as a stale one', async () => {
    api.createChannel.mockRejectedValueOnce(new Error('bad vibrationPattern'));
    api.getChannels.mockResolvedValue([
      { id: 'vokve.hydration.fallback' },
      { id: reminderChannelId('chime', true) },
    ]);

    await syncHydrationReminders(PLAN, { now: NOW });

    expect(api.deleteChannel).toHaveBeenCalledTimes(1);
    expect(api.deleteChannel).toHaveBeenCalledWith(reminderChannelId('chime', true));
  });

  test('on iOS the sound is on the notification, since there are no channels', async () => {
    Platform.OS = 'ios';

    await syncHydrationReminders(PLAN, { now: NOW });

    expect(api.createChannel).not.toHaveBeenCalled();
    expect(call(0).notification.ios.sound).toBe('water_drop.wav');
  });

  test('the preview rings the sound as a real notification, and clears itself', async () => {
    jest.useFakeTimers();
    try {
      await previewReminderSound('bell', false);

      expect(api.createChannel).toHaveBeenCalledWith(
        expect.objectContaining({ id: reminderChannelId('bell', false), sound: 'bell' }),
      );
      const notification = api.displayNotification.mock.calls[0][0];
      // Android clears it itself; iOS needs the timer, which is what runs here.
      expect(notification.android.timeoutAfter).toBeGreaterThan(0);

      jest.runAllTimers();
      expect(api.cancelNotification).toHaveBeenCalledWith(notification.id);
    } finally {
      jest.useRealTimers();
    }
  });

  test('an unpermitted preview asks first — the best moment there will be', async () => {
    allowed(AuthorizationStatus.DENIED);
    api.requestPermission.mockResolvedValueOnce({
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
      android: { alarm: AndroidNotificationSetting.ENABLED },
      ios: {},
    });

    // Pressing play is the user saying plainly that they want to hear a
    // notification, so refusing them without asking would be perverse.
    expect(await previewReminderSound('bell', true)).toBe('played');
    expect(api.requestPermission).toHaveBeenCalled();
    expect(api.displayNotification).toHaveBeenCalled();
  });

  test('a refused ask reports it, so the screen can say why it was silent', async () => {
    allowed(AuthorizationStatus.DENIED);
    api.requestPermission.mockResolvedValueOnce({
      authorizationStatus: AuthorizationStatus.DENIED,
      android: { alarm: AndroidNotificationSetting.ENABLED },
      ios: {},
    });

    expect(await previewReminderSound('bell', true)).toBe('not_permitted');
    expect(api.displayNotification).not.toHaveBeenCalled();
  });

  test('a sound the OS refuses is reported rather than passing as played', async () => {
    api.displayNotification.mockRejectedValueOnce(new Error('bad channel'));

    expect(await previewReminderSound('bell', true)).toBe('failed');
  });
});

describe('the preview is not a reminder', () => {
  test('its id is outside the alarm prefix, so nothing sweeps or follows it', async () => {
    await previewReminderSound('bell', true);

    const id = String(api.displayNotification.mock.calls[0][0].id);
    // Under the prefix it would be cancelled by a re-schedule and read as a
    // real reminder by the tap handler.
    expect(id.startsWith(ALARM_ID_PREFIX)).toBe(false);
  });
});

describe('who does the reminding (RULES Y6)', () => {
  test('a scheduled plan claims the reminding, so the server only writes the feed row', async () => {
    await syncHydrationReminders(PLAN, { now: NOW });

    expect(deviceApi.setLocalReminders).toHaveBeenCalledWith('dev-1', true);
  });

  test('a plan with nothing to ring hands the reminding back to the server', async () => {
    await syncHydrationReminders({ ...PLAN, enabled: false }, { now: NOW });

    expect(api.createTriggerNotification).not.toHaveBeenCalled();
    expect(deviceApi.setLocalReminders).toHaveBeenCalledWith('dev-1', false);
  });

  test('a refused permission hands it back too, so the member is still reminded', async () => {
    allowed(AuthorizationStatus.DENIED);

    const status = await syncHydrationReminders(PLAN, { now: NOW });

    expect(status).toEqual({ scheduled: 0, allowed: false, exact: false });
    expect(api.createTriggerNotification).not.toHaveBeenCalled();
    expect(deviceApi.setLocalReminders).toHaveBeenCalledWith('dev-1', false);
  });

  test('a server that cannot be told is not a reason to fail the schedule', async () => {
    deviceApi.setLocalReminders.mockRejectedValueOnce(new Error('offline'));

    expect(await syncHydrationReminders(PLAN, { now: NOW })).toMatchObject({
      scheduled: 2,
    });
  });
});

describe('cancelling', () => {
  test('clears only Vokve’s own alarms', async () => {
    api.getTriggerNotificationIds.mockResolvedValue([
      `${ALARM_ID_PREFIX}10:00`,
      'workout.alarm',
    ]);

    await cancelHydrationReminders();

    expect(api.cancelTriggerNotifications).toHaveBeenCalledWith([
      `${ALARM_ID_PREFIX}10:00`,
    ]);
  });

  test('with nothing of ours scheduled it cancels nothing', async () => {
    api.getTriggerNotificationIds.mockResolvedValue(['workout.alarm']);

    await cancelHydrationReminders();

    expect(api.cancelTriggerNotifications).not.toHaveBeenCalled();
  });
});
