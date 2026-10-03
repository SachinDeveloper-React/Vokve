import { useEffect, useRef } from 'react';
import {
  endStepSession,
  startStepSession,
  updateStepProfile,
  type StepProfile,
} from '../services/steps';
import {
  useAuthStatus,
  useCurrentUser,
  useIsProfileComplete,
} from '../stores/authStore';
import { useDailyStepGoal } from '../stores/settingsStore';

/**
 * Runs the step session for whoever is signed in. Mounted once, at the root,
 * so it follows the session rather than any screen: it starts when a user
 * with a finished profile is in, follows their height, weight, gender and
 * goal from there, and ends when they are not.
 *
 * Ending is not stopping — see `endStepSession`. An expired session leaves
 * the phone counting; only an explicit sign-out stops it.
 */
export function useStepTrackingSession(): void {
  const status = useAuthStatus();
  const user = useCurrentUser();
  const isProfileComplete = useIsProfileComplete();
  const dailyGoal = useDailyStepGoal();

  const userId =
    status === 'authenticated' && isProfileComplete ? user?.id ?? null : null;
  const heightCm = user?.heightCm ?? null;
  const weightKg = user?.weightKg ?? null;
  const gender = user?.gender ?? null;

  const profile = useRef<StepProfile | null>(null);
  profile.current = userId
    ? { userId, heightCm, weightKg, gender, dailyGoal }
    : null;

  // Only who is signed in starts and ends a session; the profile's own
  // changes go through the effect below as config updates.
  useEffect(() => {
    if (!profile.current) {
      endStepSession();
      return;
    }
    startStepSession(profile.current);
  }, [userId]);

  useEffect(() => {
    if (userId) {
      updateStepProfile({ userId, heightCm, weightKg, gender, dailyGoal });
    }
  }, [userId, heightCm, weightKg, gender, dailyGoal]);
}
