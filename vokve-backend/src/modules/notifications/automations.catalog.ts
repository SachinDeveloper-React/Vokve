import { z } from 'zod';
import type { NotificationPreferenceKey, NotificationTopic } from '../../contracts/index.js';

/**
 * The automated messages the server sends on its own (RULES M11), and the
 * defaults each starts from.
 *
 * Built in rather than invented in the panel: each one needs a reason the
 * server can check — the member is behind on today's goal, has been away
 * three days, is on an old build — and a reason is code. What the operator
 * owns is everything around it: on or off, the hour on the member's own
 * clock, the weekdays, the thresholds, and the words, several of them, in
 * rotation. Anything with no reason behind it ("tell everyone on Fridays")
 * is a scheduled message instead, which the operator writes whole.
 */

export const AUTOMATION_KEYS = [
  'morning_motivation',
  'afternoon_check',
  'goal_reached',
  'weekly_summary',
  'win_back',
  'app_update',
  'health_tip',
  'wishlist_goal',
] as const;
export type AutomationKey = (typeof AUTOMATION_KEYS)[number];

/** What kind of message it is — the panel groups by it, and campaigns choose one. */
export const MESSAGE_CATEGORIES = ['motivation', 'information', 'update', 'offer', 'reward'] as const;
export type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];

/** Where a scheduled message files and which switch can silence it. */
export const CATEGORY_ROUTE: Record<Exclude<MessageCategory, 'reward'>, { topic: NotificationTopic; preference: NotificationPreferenceKey }> = {
  motivation: { topic: 'steps', preference: 'motivation' },
  information: { topic: 'system', preference: 'motivation' },
  update: { topic: 'system', preference: 'announcements' },
  offer: { topic: 'reward', preference: 'offers' },
};

/**
 * Where a tap may be sent (RULES M10). A closed list on purpose: the app
 * has to know each one, and an unknown link falls back to the topic's
 * screen. `product:<id>` is the one with an argument.
 */
export const LINKS = ['home', 'steps', 'wallet', 'shop', 'wishlist', 'update'] as const;
export const linkSchema = z
  .string()
  .trim()
  .max(80)
  .refine(value => (LINKS as readonly string[]).includes(value) || /^product:[a-z0-9][a-z0-9-]{0,79}$/.test(value), {
    message: `A link is one of ${LINKS.join(', ')}, or product:<item id>.`,
  });

export interface AutomationTemplate {
  id: string;
  /** Which message this is a version of; most automations have one, `default`. */
  slot: string;
  title: string;
  message: string;
  active: boolean;
}

export interface AutomationSlot {
  key: string;
  label: string;
  /** The `{names}` its words may use. Anything else is refused on save. */
  variables: string[];
}

export interface AutomationDefinition {
  key: AutomationKey;
  label: string;
  /** What makes it go, in the operator's terms. */
  trigger: string;
  category: MessageCategory;
  topic: NotificationTopic;
  preference: NotificationPreferenceKey;
  /** `hour`: at the member's local hour on the chosen weekdays. `event`: as it happens. */
  timing: 'hour' | 'event';
  /**
   * Inside the member's quiet hours: dropped (true) or held until they end
   * (false). True for anything only worth its own moment — "you are behind
   * today" read tomorrow morning is wrong.
   */
  dropInQuietHours: boolean;
  /** The member's own news is never held back by the daily cap. */
  exemptFromCap: boolean;
  slots: AutomationSlot[];
  /** The knobs this automation has, each with its bounds. */
  params: z.ZodTypeAny;
  defaults: {
    enabled: boolean;
    hour: number | null;
    weekdays: number[];
    params: Record<string, unknown>;
    templates: AutomationTemplate[];
  };
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const one = (id: string, title: string, message: string, slot = 'default'): AutomationTemplate => ({ id, slot, title, message, active: true });

const PERSON = ['firstName'];

export const AUTOMATIONS: Record<AutomationKey, AutomationDefinition> = {
  morning_motivation: {
    key: 'morning_motivation',
    label: 'Morning motivation',
    trigger: 'Every chosen day at the hour, to every active member.',
    category: 'motivation',
    topic: 'steps',
    preference: 'motivation',
    timing: 'hour',
    dropInQuietHours: true,
    exemptFromCap: false,
    slots: [{ key: 'default', label: 'Message', variables: [...PERSON, 'goal', 'coins'] }],
    params: z.object({}).strict(),
    defaults: {
      enabled: true,
      hour: 8,
      weekdays: EVERY_DAY,
      params: {},
      templates: [
        one('morning-1', 'Good morning[, {firstName}] ☀️', "Today's goal is {goal} steps. Start with a short walk and the rest follows."),
        one('morning-2', 'Rise and move 👟', '{goal} steps today — every one of them counts towards your next reward.'),
        one('morning-3', 'Small steps, big wins', 'A 10-minute walk after breakfast is about 1,000 steps. Today’s goal: {goal}.'),
        one('morning-4', 'A fresh day[, {firstName}]', 'Take the stairs, walk your calls, and watch the steps add up to {goal}.'),
      ],
    },
  },

  afternoon_check: {
    key: 'afternoon_check',
    label: 'Afternoon check-in',
    trigger: 'At the hour, to members whose steps so far are under the set share of their goal (and above zero, so a phone that has not synced is not told it walked nothing).',
    category: 'motivation',
    topic: 'steps',
    preference: 'motivation',
    timing: 'hour',
    dropInQuietHours: true,
    exemptFromCap: false,
    slots: [{ key: 'default', label: 'Message', variables: [...PERSON, 'steps', 'goal', 'stepsLeft', 'percent'] }],
    params: z.object({ belowPercent: z.number().int().min(10).max(95) }).strict(),
    defaults: {
      enabled: true,
      hour: 16,
      weekdays: EVERY_DAY,
      params: { belowPercent: 50 },
      templates: [
        one('afternoon-1', '{stepsLeft} steps to go 🚶', 'You are at {steps} of {goal}. A 20-minute walk now gets you most of the way.'),
        one('afternoon-2', 'Halfway check-in', '{percent}% of today’s goal so far. There is still time — fit in a walk before dinner.'),
        one('afternoon-3', 'Let’s close the gap[, {firstName}]', '{stepsLeft} steps left for today’s {goal}. You’ve got this.'),
      ],
    },
  },

  goal_reached: {
    key: 'goal_reached',
    label: 'Daily goal reached',
    trigger: 'Within the hour of the server verifying that today’s steps reached the member’s goal. Once a day.',
    category: 'motivation',
    topic: 'steps',
    preference: 'motivation',
    timing: 'event',
    dropInQuietHours: true,
    exemptFromCap: true,
    slots: [{ key: 'default', label: 'Message', variables: [...PERSON, 'steps', 'goal'] }],
    params: z.object({}).strict(),
    defaults: {
      enabled: true,
      hour: null,
      weekdays: EVERY_DAY,
      params: {},
      templates: [
        one('goal-1', 'Goal smashed! 🎉', '{steps} steps today — you beat your {goal} goal. Same again tomorrow?'),
        one('goal-2', 'You did it[, {firstName}] 🏆', 'Today’s {goal}-step goal is done. Every extra step still counts.'),
      ],
    },
  },

  weekly_summary: {
    key: 'weekly_summary',
    label: 'Weekly summary',
    trigger: 'On the chosen day at the hour, the seven days before it — to members who walked at all.',
    category: 'information',
    topic: 'steps',
    preference: 'motivation',
    timing: 'hour',
    dropInQuietHours: false,
    exemptFromCap: false,
    slots: [
      {
        key: 'default',
        label: 'Message',
        variables: [...PERSON, 'weekSteps', 'goalDays', 'weekCoins', 'bestDay', 'bestDaySteps', 'averageSteps'],
      },
    ],
    params: z.object({}).strict(),
    defaults: {
      enabled: true,
      hour: 9,
      weekdays: [0],
      params: {},
      templates: [
        one(
          'week-1',
          'Your week in steps 📊',
          '{weekSteps} steps, {goalDays} of 7 goal days[ and {weekCoins} coins earned]. Best day: {bestDay} with {bestDaySteps} steps.',
        ),
      ],
    },
  },

  win_back: {
    key: 'win_back',
    label: 'Win-back',
    trigger: 'At the hour, to members none of whose phones has been in touch for exactly one of the set numbers of days.',
    category: 'motivation',
    topic: 'steps',
    preference: 'motivation',
    timing: 'hour',
    dropInQuietHours: true,
    exemptFromCap: false,
    slots: [{ key: 'default', label: 'Message', variables: [...PERSON, 'days', 'coins'] }],
    params: z
      .object({ afterDays: z.array(z.number().int().min(1).max(90)).min(1).max(5) })
      .strict(),
    defaults: {
      enabled: true,
      hour: 18,
      weekdays: EVERY_DAY,
      params: { afterDays: [3, 7, 14] },
      templates: [
        one('back-1', 'We miss you[, {firstName}] 👋', 'It has been {days} days.[ Your {coins} coins are waiting.] Open VOKVE and pick up where you left off.'),
        one('back-2', 'Your goal is still here', 'A short walk today is all it takes to get going again.[ {coins} coins are waiting for you.]'),
      ],
    },
  },

  app_update: {
    key: 'app_update',
    label: 'App update available',
    trigger: 'At the hour, to members whose newest phone runs an older version than the newest release for its platform. Once per release.',
    category: 'update',
    topic: 'system',
    preference: 'announcements',
    timing: 'hour',
    dropInQuietHours: false,
    exemptFromCap: false,
    slots: [{ key: 'default', label: 'Message', variables: [...PERSON, 'version', 'notes'] }],
    params: z.object({}).strict(),
    defaults: {
      enabled: true,
      hour: 12,
      weekdays: EVERY_DAY,
      params: {},
      templates: [one('update-1', 'A new VOKVE is here ✨', 'Version {version} is ready to install.[ What’s new: {notes}]')],
    },
  },

  health_tip: {
    key: 'health_tip',
    label: 'Tip of the day',
    trigger: 'On the chosen days at the hour, the day’s line from Quotes & tips (the screen named below).',
    category: 'information',
    topic: 'health',
    preference: 'motivation',
    timing: 'hour',
    dropInQuietHours: false,
    exemptFromCap: false,
    slots: [{ key: 'default', label: 'Message', variables: [...PERSON, 'tip', 'tipTitle'] }],
    params: z
      .object({ tipTopic: z.enum(['motivation', 'hydration', 'nutrition', 'health']) })
      .strict(),
    defaults: {
      enabled: true,
      hour: 13,
      weekdays: [1, 3],
      params: { tipTopic: 'health' },
      templates: [one('tip-1', '💡 Tip of the day', '{tip}')],
    },
  },

  wishlist_goal: {
    key: 'wishlist_goal',
    label: 'Saved reward now affordable',
    trigger: 'As soon as a credit takes the wallet to a saved item’s coin goal (checked hourly as well, for restocks and price drops). Once per item until the wallet drops below it again, and not within the cooldown.',
    category: 'reward',
    topic: 'reward',
    preference: 'coins',
    timing: 'event',
    dropInQuietHours: false,
    exemptFromCap: true,
    slots: [
      { key: 'one', label: 'One item', variables: [...PERSON, 'item', 'goal', 'balance'] },
      { key: 'many', label: 'Several at once', variables: [...PERSON, 'count', 'items', 'balance'] },
    ],
    params: z.object({ cooldownDays: z.number().int().min(0).max(60) }).strict(),
    defaults: {
      enabled: true,
      hour: null,
      weekdays: EVERY_DAY,
      params: { cooldownDays: 7 },
      templates: [
        one('wish-one-1', 'You can redeem {item} now 🎉', 'You have {balance} coins — enough for {item}. Tap to redeem it.', 'one'),
        one('wish-many-1', '{count} rewards are ready for you 🎉', 'Your {balance} coins now cover {items}. Tap to see your wishlist.', 'many'),
      ],
    },
  },
};

/** The variables a scheduled message may use: the member, not the moment. */
export const CAMPAIGN_VARIABLES = ['firstName', 'goal', 'coins'];

/**
 * Fills `{name}` from `vars`. Text in `[square brackets]` is left out when
 * any value inside it is empty or zero — "We miss you[, {firstName}]" for a
 * member with no name on file reads "We miss you", not "We miss you, ".
 * Numbers are grouped the Indian way, as every other figure the app shows.
 */
export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  const isEmpty = (name: string): boolean => {
    const value = vars[name];
    return value === null || value === undefined || value === '' || value === 0;
  };
  const valueOf = (name: string): string => {
    const value = vars[name];
    if (value === null || value === undefined) return '';
    return typeof value === 'number' ? value.toLocaleString('en-IN') : value;
  };
  const optional = text.replace(/\[([^[\]]*)\]/g, (_match, inner: string) => {
    const names = [...inner.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
    return names.some(isEmpty) ? '' : inner;
  });
  return optional
    .replace(/\{(\w+)\}/g, (_match, name: string) => valueOf(name))
    .replace(/\s+([,.!?—])/g, (_match, mark: string) => (mark === '—' ? ` ${mark}` : mark))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The `{names}` a piece of text uses. */
export function variablesIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]))];
}
