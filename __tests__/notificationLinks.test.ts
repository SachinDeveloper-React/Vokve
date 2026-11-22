/**
 * Where a tapped notification goes (RULES M10): a message's own link when
 * this build knows it, its topic's screen when it does not — so a link the
 * server starts sending after a release is never a dead tap — and the
 * "Tips & Motivation" switch (RULES M9) reading as on for a device that
 * stored its switches before the switch existed.
 *
 * @format
 */

import { mmkvStorage } from '../src/stores';
import { useNotificationSettingsStore } from '../src/stores/notificationSettingsStore';
import { routeForLink, routeForPush } from '../src/services/notifications';
import {
  appNotificationSchema,
  notificationPreferencesSchema,
} from '../src/types/models';

describe('routeForLink', () => {
  test('names the screen, tab or product each link means', () => {
    expect(routeForLink('product:wrist-wraps')).toEqual({
      kind: 'product',
      id: 'wrist-wraps',
    });
    expect(routeForLink('wishlist')).toEqual({
      kind: 'screen',
      name: 'Wishlist',
    });
    expect(routeForLink('update')).toEqual({ kind: 'screen', name: 'About' });
    expect(routeForLink('steps')).toEqual({
      kind: 'screen',
      name: 'StepTracking',
    });
    expect(routeForLink('shop')).toEqual({ kind: 'tab', name: 'Shop' });
    expect(routeForLink('home')).toEqual({ kind: 'tab', name: 'Home' });
    expect(routeForLink('wallet')).toEqual({ kind: 'tab', name: 'Wallet' });
  });

  test('knows nothing it was not built with', () => {
    expect(routeForLink(null)).toBeNull();
    expect(routeForLink('product:')).toBeNull();
    expect(routeForLink('leaderboard')).toBeNull();
  });

  test('a push falls back to its topic when the link is unknown or missing', () => {
    expect(routeForPush('streak', 'leaderboard')).toEqual({
      kind: 'screen',
      name: 'Streak',
    });
    expect(routeForPush('reward', undefined)).toEqual({
      kind: 'screen',
      name: 'Notifications',
    });
    expect(routeForPush('reward', 'product:socks')).toEqual({
      kind: 'product',
      id: 'socks',
    });
  });
});

describe('what an older server or an older device sends', () => {
  test('a row and a preference record from before the fields parse with their defaults', () => {
    expect(
      appNotificationSchema.parse({
        id: 'n',
        topic: 'steps',
        title: 't',
        message: 'm',
        createdAt: '2026-11-22T00:00:00Z',
      }),
    ).toMatchObject({ link: null });
    const prefs = notificationPreferencesSchema.parse({
      categories: {
        activity: true,
        coins: true,
        challenges: true,
        orders: true,
        offers: true,
        announcements: true,
        referrals: true,
        health: false,
      },
      quietHours: { enabled: true, start: '22:00', end: '07:00' },
      sms: true,
      email: false,
    });
    expect(prefs.categories.motivation).toBe(true);
  });

  test('switches stored before Tips & Motivation existed read it as on', async () => {
    mmkvStorage.setItem(
      'vokve.notificationSettings',
      JSON.stringify({
        state: {
          categories: {
            activity: true,
            coins: false,
            challenges: true,
            orders: true,
            offers: true,
            announcements: true,
            referrals: true,
            health: false,
          },
          quietHours: { enabled: true, start: '22:00', end: '07:00' },
          sms: true,
          email: false,
          syncedAt: null,
        },
        version: 1,
      }),
    );
    await useNotificationSettingsStore.persist.rehydrate();
    const { categories } = useNotificationSettingsStore.getState();
    expect(categories.motivation).toBe(true);
    expect(categories.coins).toBe(false);
  });
});
