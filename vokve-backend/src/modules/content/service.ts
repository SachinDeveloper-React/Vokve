import {
  contentTipSchema,
  referralCardsSchema,
  type ContentTip,
  type ReferralCard,
  type ReferralCards,
} from '../../contracts/index.js';
import { getConfig } from '../../config/remote.js';
import { Errors } from '../../lib/errors.js';
import { localDayOf } from '../../lib/dates.js';
import { ContentTipModel, REFERRAL_SCREENS, ReferralPromoModel } from './models.js';

/**
 * The day's tip for one place in the app: the same one all day, the next
 * one tomorrow, round the topic's active tips in order. Chosen by the
 * caller's own day so the tip changes at their midnight.
 */
export async function tipOfTheDay(topic: string, timeZone: string, now = new Date()): Promise<ContentTip> {
  const tips = await ContentTipModel.find({ topic, active: true }).sort({ sort: 1, _id: 1 }).lean();
  if (tips.length === 0) throw Errors.notFound('A tip');
  const dayNumber = Math.floor(Date.parse(`${localDayOf(now, timeZone)}T00:00:00Z`) / 86_400_000);
  const tip = tips[dayNumber % tips.length];
  return contentTipSchema.parse({ id: tip._id, topic: tip.topic, title: tip.title ?? null, text: tip.text });
}

/** The day the rotation is on, counted from the caller's own midnight. */
function dayNumberOf(timeZone: string, now: Date): number {
  return Math.floor(Date.parse(`${localDayOf(now, timeZone)}T00:00:00Z`) / 86_400_000);
}

/**
 * The reward figures written into a card's words.
 *
 * `{coins}` is what the member earns per friend and `{friendCoins}` what the
 * friend gets, both from `coins.referral` as it is actually paying. Filled
 * here rather than typed by an operator: a card is a promise, and the only
 * number safe to print on it is the one the ledger will honour.
 */
function fill(text: string, inviter: number, invitee: number): string {
  return text
    .replace(/\{coins\}/g, String(inviter))
    .replace(/\{friendCoins\}/g, String(invitee));
}

/**
 * Every screen's invite card, in one answer (BACKEND §6.15).
 *
 * One active card per screen: where a screen has several, they rotate a day
 * at a time on the caller's own clock, the same way tips do, so a campaign
 * can run two lines at once. A screen with nothing active is left out of the
 * map entirely, and the app draws no card there — which is how a card is
 * switched off for one screen without touching the others.
 */
export async function referralCards(timeZone: string, now = new Date()): Promise<ReferralCards> {
  const [rows, config] = await Promise.all([
    ReferralPromoModel.find({ active: true }).sort({ screen: 1, sort: 1, _id: 1 }).lean(),
    getConfig(),
  ]);

  const { inviter, invitee } = config.coins.referral;
  const day = dayNumberOf(timeZone, now);
  const cards: Record<string, ReferralCard> = {};

  for (const screen of REFERRAL_SCREENS) {
    const forScreen = rows.filter(row => row.screen === screen);
    if (forScreen.length === 0) continue;
    const row = forScreen[day % forScreen.length];
    cards[screen] = {
      id: row._id,
      screen,
      title: fill(row.title, inviter, invitee),
      message: fill(row.message, inviter, invitee),
      ctaLabel: row.ctaLabel ?? 'Invite friends',
      accent: (row.accent ?? 'brand') as ReferralCard['accent'],
      position: (row.position ?? 'bottom') as ReferralCard['position'],
      emoji: row.emoji ?? '\u{1F381}',
      inviterCoins: inviter,
      inviteeCoins: invitee,
    };
  }

  return referralCardsSchema.parse({ cards });
}
