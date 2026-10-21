/**
 * Only the steps the server verified are shown (`verifiedActivityOf`).
 *
 * A phone's counter and the notification its service draws hold everything
 * the phone saw — a watch's steps out of Health Connect, and the steps the
 * counter handed over in one go when an OEM task killer let the service
 * back. The server judges the day and answers with both figures; these
 * checks are about the app keeping the smaller one, and taking the same
 * share off the distance, the calories and the active minutes so a verified
 * count never carries the whole day's walking.
 *
 * @format
 */

import { mockSnapshot } from 'react-native-step-tracker-pro/jest';
import { liveTailOf, verifiedActivityOf, verifiedStepsOf } from '../src/stores/stepsStore';
import { todayIso } from '../src/utils/date';
import type { ActivityConfig, DailyActivity } from '../src/types/models';

const day = (over: Partial<DailyActivity> = {}): DailyActivity => ({
  date: '2026-10-18',
  steps: 11_199,
  verifiedSteps: 8_569,
  distanceKm: 8.4,
  activeMinutes: 96,
  caloriesBurned: 420,
  workoutsCompleted: 0,
  source: 'device',
  verified: true,
  ...over,
});

describe('verifiedActivityOf', () => {
  test('keeps the verified count, not the one the phone sent', () => {
    const activity = verifiedActivityOf(day());

    expect(activity.steps).toBe(8_569);
    expect(activity.counted).toBe(11_199);
    expect(activity.unverified).toBe(11_199 - 8_569);
    expect(activity.state).toBe('partly');
  });

  test('takes the same share off the distance, the calories and the minutes', () => {
    const activity = verifiedActivityOf(day());
    const share = 8_569 / 11_199;

    expect(activity.distanceKm).toBeCloseTo(8.4 * share, 5);
    expect(activity.caloriesBurned).toBeCloseTo(420 * share, 5);
    expect(activity.activeMinutes).toBe(Math.round(96 * share));
  });

  test('a day the server verified none of shows nothing, not the count it refused', () => {
    const activity = verifiedActivityOf(
      day({ verifiedSteps: 0, verified: false }),
    );

    expect(activity.steps).toBe(0);
    expect(activity.distanceKm).toBe(0);
    expect(activity.caloriesBurned).toBe(0);
    expect(activity.activeMinutes).toBe(0);
    expect(activity.unverified).toBe(11_199);
    expect(activity.state).toBe('held');
  });

  test('a day verified end to end is shown whole', () => {
    const activity = verifiedActivityOf(day({ verifiedSteps: 11_199 }));

    expect(activity.steps).toBe(11_199);
    expect(activity.unverified).toBe(0);
    expect(activity.distanceKm).toBeCloseTo(8.4, 5);
    expect(activity.state).toBe('verified');
  });

  test('a verified figure above the day it belongs to is held to the day', () => {
    const activity = verifiedActivityOf(
      day({ steps: 100, verifiedSteps: 9_000 }),
    );

    expect(activity.steps).toBe(100);
    expect(activity.unverified).toBe(0);
    expect(activity.state).toBe('verified');
  });

  test('a day with no steps is a verified zero, and carries no distance', () => {
    const activity = verifiedActivityOf(
      day({
        steps: 0,
        verifiedSteps: 0,
        distanceKm: 0,
        caloriesBurned: 0,
        activeMinutes: 0,
      }),
    );

    expect(activity.steps).toBe(0);
    expect(activity.state).toBe('verified');
  });

  test('before the server has answered nothing is claimed', () => {
    expect(verifiedActivityOf(null)).toEqual({
      steps: 0,
      counted: 0,
      unverified: 0,
      distanceKm: 0,
      caloriesBurned: 0,
      activeMinutes: 0,
      state: 'pending',
    });
  });
});

describe('verifiedStepsOf', () => {
  test('a chart bar is the verified part of the day', () => {
    expect(verifiedStepsOf(day())).toBe(8_569);
    expect(verifiedStepsOf({ steps: 500, verifiedSteps: 0 })).toBe(0);
  });

  test('a day the server has not answered for is a bar of zero', () => {
    expect(verifiedStepsOf(null)).toBe(0);
    expect(verifiedStepsOf(undefined)).toBe(0);
  });
});

/**
 * The dashboard's live tail: what this phone has counted since the server
 * last took a figure from it, less the part the phone already doubts.
 *
 * The tracker's checks run live, so a shaken or in-vehicle minute is in
 * `suspectSteps` the moment it is walked. Taking those off the tail is what
 * stops the number climbing on a minute the server is going to refuse — it
 * stalls instead, which is the point of doing it here rather than letting
 * the tracker remove them from its own count and shrink in front of the user.
 */
describe('liveTailOf', () => {
  const localDay = todayIso();
  const config = (mode: 'flag' | 'exclude') =>
    ({ tracker: { fraudDetection: { enabled: true, mode } } } as unknown as ActivityConfig);
  const mark = (over: { steps: number; suspectSteps?: number }) => ({
    [localDay]: { steps: over.steps, recoveredSteps: 0, suspectSteps: over.suspectSteps ?? 0, at: Date.now() },
  });

  test('is what the phone has counted past its last accepted sync', () => {
    expect(
      liveTailOf({
        today: mockSnapshot({ date: localDay, steps: 3020 }),
        synced: mark({ steps: 3000 }),
        activityConfig: config('flag'),
      }),
    ).toBe(20);
  });

  test('a minute walked and flagged in the same breath makes the number stall, not climb', () => {
    expect(
      liveTailOf({
        today: mockSnapshot({ date: localDay, steps: 3060, suspectSteps: 60 }),
        synced: mark({ steps: 3000, suspectSteps: 0 }),
        activityConfig: config('flag'),
      }),
    ).toBe(0);
    // Half flagged: half of them count.
    expect(
      liveTailOf({
        today: mockSnapshot({ date: localDay, steps: 3060, suspectSteps: 30 }),
        synced: mark({ steps: 3000, suspectSteps: 0 }),
        activityConfig: config('flag'),
      }),
    ).toBe(30);
  });

  test('only takes off what was flagged since the sync, not the whole day’s', () => {
    // 500 flagged on the day, but 480 were already inside the figure the
    // server took — only the 20 since then come off the tail.
    expect(
      liveTailOf({
        today: mockSnapshot({ date: localDay, steps: 9100, suspectSteps: 500 }),
        synced: mark({ steps: 9000, suspectSteps: 480 }),
        activityConfig: config('flag'),
      }),
    ).toBe(80);
  });

  test('leaves them alone under exclude, where the tracker has already removed them', () => {
    expect(
      liveTailOf({
        today: mockSnapshot({ date: localDay, steps: 3060, suspectSteps: 60 }),
        synced: mark({ steps: 3000, suspectSteps: 0 }),
        activityConfig: config('exclude'),
      }),
    ).toBe(60);
  });

  test('never goes below zero, and ignores a snapshot from another day', () => {
    // A counter reset, or a day started over at a sign-in.
    expect(
      liveTailOf({
        today: mockSnapshot({ date: localDay, steps: 40 }),
        synced: mark({ steps: 3000 }),
        activityConfig: config('flag'),
      }),
    ).toBe(0);
    expect(
      liveTailOf({
        today: mockSnapshot({ date: '2020-01-01', steps: 9999 }),
        synced: {},
        activityConfig: config('flag'),
      }),
    ).toBe(0);
    expect(liveTailOf({ today: null, synced: {}, activityConfig: null })).toBe(0);
  });

  test('leaves the other phones’ steps out — they are already in the figure it adds to', () => {
    expect(
      liveTailOf({
        today: mockSnapshot({ date: localDay, steps: 5020, otherDevicesSteps: 2000 }),
        synced: mark({ steps: 3000 }),
        activityConfig: config('flag'),
      }),
    ).toBe(20);
  });
});
