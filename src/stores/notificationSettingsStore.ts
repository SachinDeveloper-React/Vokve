import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { NotificationPreferencesPatch } from '../services/api/contracts';
import { notificationPreferencesApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { NotificationPreferences } from '../types/models';
import { logger } from '../utils/logger';
import { mmkvStorage } from './index';

/**
 * What the app may send, by subject.
 *
 * Finer-grained than the notification centre's own `activity | reward |
 * system` filters, and deliberately so: those three are how a feed is *read*,
 * where these eight are what the app is allowed to *send*. A user who wants
 * shop updates but not promotions has to be able to say so, and no filter on
 * a list can express that.
 */
export const NOTIFICATION_CATEGORIES = [
  'activity',
  'coins',
  'challenges',
  'orders',
  'offers',
  'announcements',
  'referrals',
  'health',
] as const;

export type NotificationCategoryKey = (typeof NOTIFICATION_CATEGORIES)[number];

export type CategorySwitches = Record<NotificationCategoryKey, boolean>;

/**
 * Everything on by default except health reminders.
 *
 * Health is the one category that is about the user's body rather than about
 * the app, and a fitness app that started pushing hydration and measurement
 * prompts before being asked is the reason people turn notifications off
 * wholesale.
 */
const DEFAULT_CATEGORIES: CategorySwitches = {
  activity: true,
  coins: true,
  challenges: true,
  orders: true,
  offers: true,
  announcements: true,
  referrals: true,
  health: false,
};

export interface QuietHours {
  enabled: boolean;
  /** 24-hour `HH:mm`, local. The window may run past midnight. */
  start: string;
  end: string;
}

const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: true,
  start: '22:00',
  end: '07:00',
};

interface NotificationSettingsState {
  categories: CategorySwitches;
  quietHours: QuietHours;
  /** Order and delivery updates by text message. */
  sms: boolean;
  email: boolean;
  /** When the server last confirmed these; null until the first sync. */
  syncedAt: string | null;
  isSyncing: boolean;
  /**
   * Why the last write was refused, for the screen to say so. The switch
   * has already been put back to what the server holds by then.
   */
  saveError: string | null;

  /**
   * Replaces the local choices with the server's (`GET
   * /me/notification-preferences`). The server enforces these before any
   * push, so its copy is the one that counts; the device's is a cache so
   * the screen opens on the right switches before the network answers.
   */
  hydrateFromServer: () => Promise<void>;
  setCategory: (key: NotificationCategoryKey, value: boolean) => void;
  /** Turns every category on — what the "Enable All" link does. */
  enableAll: () => void;
  setQuietHours: (quietHours: Partial<QuietHours>) => void;
  setSms: (value: boolean) => void;
  setEmail: (value: boolean) => void;
  clearSaveError: () => void;
  reset: () => void;
}

/** The switches, as the server's record carries them. */
function fromServer(prefs: NotificationPreferences) {
  return {
    categories: prefs.categories,
    quietHours: prefs.quietHours,
    sms: prefs.sms,
    email: prefs.email,
  };
}

/**
 * What the user has agreed to be told about.
 *
 * Separate from the notifications store, which holds the feed. This one is
 * consent: it decides what is ever sent, and it is the only part of the two
 * that has to survive a reinstall of the feed's contents.
 *
 * Every switch flips on the device at once and is sent as a patch; a refused
 * write puts the switch back and says why. Consent is a thing the server
 * enforces, so a toggle the server never heard about would be a promise the
 * app could not keep.
 */
export const useNotificationSettingsStore = create<NotificationSettingsState>()(
  persist(
    (set, get) => {
      /**
       * Applies the change locally, sends it, and on refusal restores the
       * previous values. The server's answer is the whole record and
       * replaces ours: a clamp or a default it applied is then what shows.
       */
      const write = (
        local: Partial<
          Pick<
            NotificationSettingsState,
            'categories' | 'quietHours' | 'sms' | 'email'
          >
        >,
        patch: NotificationPreferencesPatch,
      ) => {
        const before = {
          categories: get().categories,
          quietHours: get().quietHours,
          sms: get().sms,
          email: get().email,
        };
        set({ ...local, saveError: null });
        // Only a synced store has a server record to patch; before that the
        // choice is local and the first sync brings the server's copy.
        if (get().syncedAt === null) {
          return;
        }
        notificationPreferencesApi
          .update(patch)
          .then(prefs =>
            set({ ...fromServer(prefs), syncedAt: new Date().toISOString() }),
          )
          .catch(error => {
            const apiError = toApiError(error);
            logger.warn(
              'notificationSettingsStore',
              'Preference write refused',
              apiError,
            );
            set({ ...before, saveError: apiError.message });
          });
      };

      return {
        categories: DEFAULT_CATEGORIES,
        quietHours: DEFAULT_QUIET_HOURS,
        sms: true,
        email: false,
        syncedAt: null,
        isSyncing: false,
        saveError: null,

        hydrateFromServer: async () => {
          if (get().isSyncing) {
            return;
          }
          set({ isSyncing: true });
          try {
            const prefs = await notificationPreferencesApi.get();
            set({
              ...fromServer(prefs),
              syncedAt: new Date().toISOString(),
              isSyncing: false,
            });
          } catch (error) {
            logger.warn(
              'notificationSettingsStore',
              'Preference sync failed',
              toApiError(error),
            );
            set({ isSyncing: false });
          }
        },

        setCategory: (key, value) =>
          write(
            { categories: { ...get().categories, [key]: value } },
            { categories: { [key]: value } },
          ),

        enableAll: () => {
          const next = { ...get().categories };
          const patch: Partial<CategorySwitches> = {};
          for (const key of NOTIFICATION_CATEGORIES) {
            if (!next[key]) {
              next[key] = true;
              patch[key] = true;
            }
          }
          if (Object.keys(patch).length === 0) {
            return;
          }
          write({ categories: next }, { categories: patch });
        },

        setQuietHours: quietHours =>
          write(
            { quietHours: { ...get().quietHours, ...quietHours } },
            { quietHours },
          ),

        setSms: value => write({ sms: value }, { sms: value }),
        setEmail: value => write({ email: value }, { email: value }),
        clearSaveError: () => set({ saveError: null }),

        reset: () =>
          set({
            categories: DEFAULT_CATEGORIES,
            quietHours: DEFAULT_QUIET_HOURS,
            sms: true,
            email: false,
            syncedAt: null,
            isSyncing: false,
            saveError: null,
          }),
      };
    },
    {
      name: 'vokve.notificationSettings',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: state => ({
        categories: state.categories,
        quietHours: state.quietHours,
        sms: state.sms,
        email: state.email,
        syncedAt: state.syncedAt,
      }),
    },
  ),
);

export const useNotificationCategories = () =>
  useNotificationSettingsStore(s => s.categories);
export const useQuietHours = () =>
  useNotificationSettingsStore(s => s.quietHours);
export const useSmsNotifications = () =>
  useNotificationSettingsStore(s => s.sms);
export const useEmailNotifications = () =>
  useNotificationSettingsStore(s => s.email);
export const useNotificationSaveError = () =>
  useNotificationSettingsStore(s => s.saveError);

/** Whether every category is already on, which is what greys out "Enable All". */
export const useAllCategoriesEnabled = () =>
  useNotificationSettingsStore(s =>
    NOTIFICATION_CATEGORIES.every(key => s.categories[key]),
  );
