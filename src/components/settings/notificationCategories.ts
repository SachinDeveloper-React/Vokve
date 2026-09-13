import type { ThemeColors } from '../../constants/colors';
import type { NotificationCategoryKey } from '../../stores/notificationSettingsStore';

export type CategoryTint = Extract<
  keyof ThemeColors,
  | 'success'
  | 'notificationCoin'
  | 'avatarPurple'
  | 'primary'
  | 'avatarPink'
  | 'brandAccent'
  | 'avatarCyan'
  | 'destructive'
>;

interface CategoryPresentation {
  title: string;
  /** What the category actually covers, in the user's terms. */
  description: string;
  tint: CategoryTint;
}

/**
 * What each category is called and covers, declared once.
 *
 * The description is the point of the row: "Challenges" on its own tells a
 * user nothing about whether switching it off will cost them the reminder that
 * a challenge is starting. Exhaustive by type, so a new category cannot ship
 * as an unexplained switch.
 */
export const CATEGORY_STYLE: Record<
  NotificationCategoryKey,
  CategoryPresentation
> = {
  activity: {
    title: 'Activity & Steps',
    description: 'Step updates, daily goal progress, streaks and step milestones',
    tint: 'success',
  },
  coins: {
    title: 'Coins & Rewards',
    description: 'Coins earned, bonus, expiry reminders and reward updates',
    tint: 'notificationCoin',
  },
  challenges: {
    title: 'Challenges',
    description: 'Challenge reminders, starts, completions and results',
    tint: 'avatarPurple',
  },
  orders: {
    title: 'Shop & Orders',
    description: 'Order confirmations, shipping, delivery and returns',
    tint: 'primary',
  },
  offers: {
    title: 'Offers & Promotions',
    description: 'Discounts, special offers and limited time deals',
    tint: 'avatarPink',
  },
  announcements: {
    title: 'Announcements',
    description: 'Important updates, new features and maintenance alerts',
    tint: 'brandAccent',
  },
  referrals: {
    title: 'Referral & Earn',
    description: 'Referral join, bonus updates and invite rewards',
    tint: 'avatarCyan',
  },
  health: {
    title: 'Health Reminders',
    description: 'Hydration, health tracking and measurement reminders',
    tint: 'destructive',
  },
};
