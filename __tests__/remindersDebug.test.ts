/**
 * The reminder diagnostic.
 *
 * It exists because a reminder plan can only be tested by waiting for a
 * minute to pass, and when nothing arrives every link in the chain is a
 * suspect. So what is checked here is that the report *names the cause* in
 * each of the ways the feature can quietly do nothing — a report that
 * printed state without pointing at the fault would be no better than the
 * silence it replaces.
 *
 * @format
 */

import { Platform } from 'react-native';
import notifee, {
  AndroidNotificationSetting,
  AuthorizationStatus,
} from '@notifee/react-native';
import { reminderReport } from '../src/services/remindersDebug';
import { useNotificationSettingsStore } from '../src/stores/notificationSettingsStore';
import { useRemindersStore } from '../src/stores/remindersStore';
import type { HydrationReminderPlan } from '../src/types/models';

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

const ON = {
  activity: true,
  coins: true,
  challenges: true,
  orders: true,
  offers: true,
  announcements: true,
  referrals: true,
  health: true,
};

const report = async () => (await reminderReport(NOW)).flat().join('\n');

afterEach(() => {
  Platform.OS = 'ios';
});

beforeEach(() => {
  api.getNotificationSettings.mockResolvedValue({
    authorizationStatus: AuthorizationStatus.AUTHORIZED,
    android: { alarm: AndroidNotificationSetting.ENABLED },
    ios: {},
  });
  api.getTriggerNotifications.mockResolvedValue([]);
  api.getChannels.mockResolvedValue([]);
  useRemindersStore.setState({ plan: PLAN });
  useNotificationSettingsStore.setState({
    categories: { ...ON },
    quietHours: { enabled: true, start: '22:00', end: '07:00' },
  });
});

describe('the reminder report', () => {
  test('names the health switch when that is what is stopping it', async () => {
    useNotificationSettingsStore.setState({ categories: { ...ON, health: false } });

    const text = await report();

    // The default is off (RULES Y6), so this is the likeliest reason a user
    // sets a time and nothing ever arrives.
    expect(text).toContain('health category:   no');
    expect(text).toContain('nothing is scheduled');
    expect(text).toContain('0 alarm(s)');
  });

  test('names the permission, and says nothing else matters until it is granted', async () => {
    api.getNotificationSettings.mockResolvedValue({
      authorizationStatus: AuthorizationStatus.DENIED,
      android: { alarm: AndroidNotificationSetting.ENABLED },
      ios: {},
    });

    const text = await report();

    expect(text).toContain('OS permission:     DENIED');
    expect(text).toContain('The OS will show nothing for this app');
  });

  test('says to rebuild when the native module does not answer at all', async () => {
    api.getNotificationSettings.mockRejectedValue(new Error('not linked'));

    const text = await report();

    expect(text).toContain('FAILED: not linked');
    expect(text).toContain('Rebuild the app');
  });

  test('points at the gap when the plan should be scheduled and the OS holds nothing', async () => {
    const text = await report();

    expect(text).toContain('2 alarm(s)');
    expect(text).toContain("The scheduler wanted alarms and the OS has none");
  });

  test('lists what the OS is holding, with when each one fires', async () => {
    api.getTriggerNotifications.mockResolvedValue([
      {
        notification: { id: 'vokve.hydration.10:00' },
        trigger: { timestamp: NOW.getTime() + 2 * 3_600_000 },
      },
      { notification: { id: 'some.other.alarm' }, trigger: {} },
    ]);

    const text = await report();

    expect(text).toContain("1 of this app's reminders");
    expect(text).toContain('vokve.hydration.10:00');
    expect(text).toContain('in 2 h 0 m');
  });

  test('says when every time is inside quiet hours', async () => {
    useRemindersStore.setState({
      plan: {
        ...PLAN,
        reminders: [{ id: 'a', time: '02:00', slot: 'custom', enabled: true }],
      },
    });

    const text = await report();

    expect(text).toContain('quiet hours:       22:00–07:00');
    expect(text).toContain('0 alarm(s)');
    expect(text).toContain('inside quiet hours');
  });

  test('says what a sound id resolves to, so a silent one can be spotted', async () => {
    // Where a sound lives differs by platform, and so does how it goes wrong.
    Platform.OS = 'android';
    const text = await report();
    expect(text).toContain('res/raw/water_drop');

    useRemindersStore.setState({ plan: { ...PLAN, sound: 'air_horn' } });
    expect(await report()).toContain('no audio in this build');

    useRemindersStore.setState({ plan: { ...PLAN, sound: 'silent' } });
    expect(await report()).toContain('no sound (deliberately)');
  });

  test('on iOS it says the sound has to be in the Xcode target', async () => {
    Platform.OS = 'ios';

    const text = await report();

    // The one setup step that cannot be done from the repo, and its symptom
    // is a reminder that arrives silently.
    expect(text).toContain('must be in the Xcode target');
    expect(text).toContain('iOS puts the sound on each notification');
  });

  test('flags a channel the user has blocked in Android’s own settings', async () => {
    Platform.OS = 'android';
    api.getChannels.mockResolvedValue([
      {
        id: 'vokve.hydration.water_drop.buzz',
        sound: 'water_drop',
        vibration: true,
        importance: 4,
        blocked: true,
      },
    ]);

    const text = await report();

    // Nothing in the app can see this, and it silences every reminder.
    expect(text).toContain('BLOCKED in Android settings');
  });

  test('a plan the server has not answered for is said plainly, not as an error', async () => {
    useRemindersStore.setState({ plan: null });

    expect(await report()).toContain('the server has not answered yet');
  });
});
