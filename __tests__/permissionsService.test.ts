/**
 * Which permission screens a phone needs after sign-in (D-54): one already
 * granted is not asked again, and one the phone has no use for — Health
 * Connect where it is not supported, physical activity where there is no
 * tracker — is not asked at all. And whether the set-up ends on the step
 * goal (D-55): only while the account has never chosen one.
 *
 * @format
 */

import { PermissionsAndroid, Platform } from 'react-native';
import {
  AuthorizationStatus,
  hasPermission,
} from '@react-native-firebase/messaging';
import StepTracker from 'react-native-step-tracker-pro';
import {
  pendingPermissionSteps,
  stepGoalNeedsChoosing,
} from '../src/services/permissions';

jest.mock('../src/services/api/endpoints', () => ({
  ...jest.requireActual('../src/services/api/endpoints'),
  activityApi: { goal: jest.fn() },
}));

const tracker = StepTracker as unknown as Record<string, jest.Mock>;
const { activityApi } = jest.requireMock('../src/services/api/endpoints') as {
  activityApi: { goal: jest.Mock };
};

const goalChosen = (chosenAt: string | null) => ({
  goal: 10_000,
  recommended: 8000,
  basedOn: { age: true, bmi: true, recentSteps: false },
  min: 3000,
  max: 20_000,
  increment: 500,
  chosenAt,
});

const android = (granted: { activity: boolean; notifications: boolean }) => {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34);
  jest
    .spyOn(PermissionsAndroid, 'check')
    .mockImplementation(async permission =>
      permission === PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION
        ? granted.activity
        : granted.notifications,
    );
};

afterEach(() => {
  jest.restoreAllMocks();
  tracker.getTrackingState.mockResolvedValue('idle');
});

test('a new Android phone gets all three, in order', async () => {
  android({ activity: false, notifications: false });
  tracker.getTrackingState.mockResolvedValue('idle');
  tracker.getHealthConnectStatus.mockResolvedValue({
    availability: 'available',
    stepsGranted: false,
  });

  expect(await pendingPermissionSteps()).toEqual([
    'activity',
    'notifications',
    'healthConnect',
  ]);
});

test('what is already granted is not asked again', async () => {
  android({ activity: true, notifications: true });
  tracker.getTrackingState.mockResolvedValue('running');
  tracker.getHealthConnectStatus.mockResolvedValue({
    availability: 'available',
    stepsGranted: true,
  });

  expect(await pendingPermissionSteps()).toEqual([]);
});

test('Health Connect is left out where this phone cannot have it', async () => {
  android({ activity: true, notifications: false });
  tracker.getTrackingState.mockResolvedValue('running');
  tracker.getHealthConnectStatus.mockResolvedValue({
    availability: 'not_supported',
    stepsGranted: false,
  });

  expect(await pendingPermissionSteps()).toEqual(['notifications']);
});

test('off Android only notifications are asked about', async () => {
  (hasPermission as jest.Mock).mockResolvedValueOnce(
    AuthorizationStatus.NOT_DETERMINED,
  );

  expect(await pendingPermissionSteps()).toEqual(['notifications']);
});

describe('the step goal at the end of the set-up', () => {
  test('is asked for until the account has chosen one, on any phone', async () => {
    activityApi.goal.mockResolvedValueOnce(goalChosen(null));
    expect(await stepGoalNeedsChoosing()).toBe(true);

    activityApi.goal.mockResolvedValueOnce(
      goalChosen('2026-10-01T08:00:00.000Z'),
    );
    expect(await stepGoalNeedsChoosing()).toBe(false);
  });

  test('is asked for when the server cannot say, or takes too long to', async () => {
    activityApi.goal.mockRejectedValueOnce(new Error('offline'));
    expect(await stepGoalNeedsChoosing()).toBe(true);

    jest.useFakeTimers();
    try {
      activityApi.goal.mockReturnValueOnce(new Promise(() => {}));
      const answer = stepGoalNeedsChoosing();
      jest.advanceTimersByTime(4000);
      expect(await answer).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
