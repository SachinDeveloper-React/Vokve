import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
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

  setCategory: (key: NotificationCategoryKey, value: boolean) => void;
  /** Turns every category on — what the "Enable All" link does. */
  enableAll: () => void;
  setQuietHours: (quietHours: Partial<QuietHours>) => void;
  setSms: (value: boolean) => void;
  setEmail: (value: boolean) => void;
  reset: () => void;
}

/**
 * What the user has agreed to be told about.
 *
 * Separate from the notifications store, which holds the feed. This one is
 * consent: it decides what is ever sent, and it is the only part of the two
 * that has to survive a reinstall of the feed's contents.
 *
 * Nothing here registers with the OS yet. It is the set of choices a push
 * service will read when the native side lands, which is why it persists.
 */
export const useNotificationSettingsStore = create<NotificationSettingsState>()(
  persist(
    set => ({
      categories: DEFAULT_CATEGORIES,
      quietHours: DEFAULT_QUIET_HOURS,
      sms: true,
      email: false,

      setCategory: (key, value) =>
        set(state => ({ categories: { ...state.categories, [key]: value } })),

      enableAll: () =>
        set(state => {
          const next = { ...state.categories };
          for (const key of NOTIFICATION_CATEGORIES) {
            next[key] = true;
          }
          return { categories: next };
        }),

      setQuietHours: quietHours =>
        set(state => ({ quietHours: { ...state.quietHours, ...quietHours } })),

      setSms: value => set({ sms: value }),
      setEmail: value => set({ email: value }),

      reset: () =>
        set({
          categories: DEFAULT_CATEGORIES,
          quietHours: DEFAULT_QUIET_HOURS,
          sms: true,
          email: false,
        }),
    }),
    {
      name: 'vokve.notificationSettings',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
    },
  ),
);

export const useNotificationCategories = () =>
  useNotificationSettingsStore(s => s.categories);
export const useQuietHours = () =>
  useNotificationSettingsStore(s => s.quietHours);
export const useSmsNotifications = () => useNotificationSettingsStore(s => s.sms);
export const useEmailNotifications = () =>
  useNotificationSettingsStore(s => s.email);

/** Whether every category is already on, which is what greys out "Enable All". */
export const useAllCategoriesEnabled = () =>
  useNotificationSettingsStore(s =>
    NOTIFICATION_CATEGORIES.every(key => s.categories[key]),
  );
