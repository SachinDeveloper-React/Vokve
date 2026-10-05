import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from './index';

/** Accounts remembered; a phone passed between more people than this asks again. */
const MAX_ACCOUNTS = 20;

interface OnboardingState {
  /**
   * The accounts that have been through the set-up on this phone — the
   * permission screens (physical activity, notifications, Health Connect),
   * whether they allowed each or said "not now", and the step goal when
   * the account had none chosen (D-55). Each account sees it once per
   * phone, after its first sign-in here; the grants themselves are the
   * phone's and the goal the account's, so signing in again has nothing
   * new to ask.
   */
  permissionsDoneFor: string[];
  finishPermissions: (userId: string) => void;
}

/**
 * What a signed-in account has already been shown on this phone. Lives on
 * the device and nowhere else: a new phone, or the app installed again,
 * asks again — which is right, since that phone has granted nothing.
 */
export const useOnboardingStore = create<OnboardingState>()(
  persist(
    set => ({
      permissionsDoneFor: [],

      finishPermissions: userId =>
        set(state => ({
          permissionsDoneFor: [
            userId,
            ...state.permissionsDoneFor.filter(id => id !== userId),
          ].slice(0, MAX_ACCOUNTS),
        })),
    }),
    {
      name: 'vokve.onboarding',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
    },
  ),
);

/** This account has been through the permission screens on this phone. */
export const usePermissionsDone = (userId: string | null | undefined) =>
  useOnboardingStore(s =>
    userId ? s.permissionsDoneFor.includes(userId) : false,
  );
