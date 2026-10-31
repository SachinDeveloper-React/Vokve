import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import {
  REFERRAL_ACCENTS,
  REFERRAL_POSITIONS,
  REFERRAL_SCREENS,
  ReferralPromoModel,
} from '../content/models.js';
import { referralCards } from '../content/service.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * The invite card the app draws around the place (BACKEND §6.15).
 *
 * Every screen that earns coins now carries one, and all of it — the
 * heading, the line, the button's words, the colour, the glyph, and which
 * screens it appears on at all — lives in `referral_promos` so a campaign
 * is a panel edit rather than a release.
 *
 * Four things worth knowing:
 *
 *   - **A screen is a place in the app, not a label.** `REFERRAL_SCREENS` is
 *     closed because each entry is a spot in a screen that was built to hold
 *     the card; a name that is not on the list would never be drawn. The
 *     list is served with the rows and the panel offers nothing else.
 *   - **The reward is not editable, and that is the point.** Write `{coins}`
 *     and `{friendCoins}` in the words and the server fills them from
 *     `coins.referral` as it is paying. A typed-in number would eventually
 *     be a number the ledger does not honour, on a card that is a promise.
 *   - **Several rows for one screen rotate daily**, in `sort` order, on the
 *     member's own clock — the same rotation `content_tips` uses. Two lines
 *     can run at once; the panel shows which one is live today.
 *   - **Nothing points at a card.** No order, no ledger row, no ticket, so a
 *     card can genuinely be deleted. `active: false` is for the one being
 *     drafted, or pulled for a fortnight.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const screenSchema = z.enum(REFERRAL_SCREENS);
const accentSchema = z.enum(REFERRAL_ACCENTS);
const positionSchema = z.enum(REFERRAL_POSITIONS);

const slug = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9][a-z0-9-]{1,60}$/,
    'An id looks like home-invite-1 — lowercase letters, numbers and hyphens',
  );

export const referralCardQuery = z.object({
  /** Words in the heading, the line, the button or the id. */
  q: z.string().max(200).default(''),
  screen: screenSchema.optional(),
  state: z.enum(['any', 'active', 'hidden']).default('any'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(['rotation', 'newest', 'title']).default('rotation'),
});
export type ReferralCardQuery = z.infer<typeof referralCardQuery>;

/**
 * Which card each screen is actually drawing today.
 *
 * The one thing an operator cannot work out from a list of rows: the
 * rotation is a function of the day and the number of active cards for that
 * screen, so "what is on the wallet right now" is a question only the server
 * can answer — and it is the first one anybody asks.
 */
async function liveToday(timeZone: string, now: Date): Promise<Record<string, string | null>> {
  const { cards } = await referralCards(timeZone, now);
  return Object.fromEntries(
    REFERRAL_SCREENS.map(screen => [screen, cards[screen]?.id ?? null]),
  );
}

export async function listReferralCards(query: ReferralCardQuery, timeZone: string, now = new Date()) {
  const filter: Record<string, unknown> = {};
  const trimmed = query.q.trim();
  if (trimmed) {
    const like = new RegExp(escape(trimmed), 'i');
    filter.$or = [{ _id: like }, { title: like }, { message: like }, { ctaLabel: like }];
  }
  if (query.screen) filter.screen = query.screen;
  if (query.state === 'active') filter.active = true;
  if (query.state === 'hidden') filter.active = false;

  const order: Record<string, 1 | -1> =
    query.sort === 'newest' ? { createdAt: -1 } : query.sort === 'title' ? { title: 1 } : { screen: 1, sort: 1, _id: 1 };

  const [rows, total, byScreen, today] = await Promise.all([
    ReferralPromoModel.find(filter).sort(order).skip(query.offset).limit(query.limit).lean(),
    ReferralPromoModel.countDocuments(filter),
    ReferralPromoModel.aggregate<{ _id: string; cards: number; active: number }>([
      { $group: { _id: '$screen', cards: { $sum: 1 }, active: { $sum: { $cond: ['$active', 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    liveToday(timeZone, now),
  ]);

  return {
    total,
    offset: query.offset,
    limit: query.limit,
    /** The places in the app a card can be written for. Closed: see the header. */
    screens: REFERRAL_SCREENS,
    accents: REFERRAL_ACCENTS,
    positions: REFERRAL_POSITIONS,
    byScreen: REFERRAL_SCREENS.map(screen => {
      const row = byScreen.find(entry => entry._id === screen);
      return {
        screen,
        cards: row?.cards ?? 0,
        active: row?.active ?? 0,
        /** The id on that screen today, or null where no card is drawn at all. */
        todayId: today[screen] ?? null,
      };
    }),
    totals: {
      cards: total,
      active: byScreen.reduce((sum, row) => sum + row.active, 0),
      /** Screens carrying no card: the invite is simply absent there. */
      silentScreens: REFERRAL_SCREENS.filter(screen => today[screen] === null),
    },
    data: rows.map(row => ({
      id: row._id,
      screen: row.screen,
      title: row.title,
      message: row.message,
      ctaLabel: row.ctaLabel ?? 'Invite friends',
      accent: row.accent ?? 'brand',
      position: row.position ?? 'bottom',
      emoji: row.emoji ?? '🎁',
      sort: row.sort ?? 0,
      active: row.active ?? true,
      /** True for the card that is on that screen today. */
      showingToday: today[row.screen] === row._id,
      createdAt: iso((row as { createdAt?: Date }).createdAt),
      updatedAt: iso((row as { updatedAt?: Date }).updatedAt),
    })),
    nextCursor: null,
  };
}

export const referralCardBody = z
  .object({
    /** Fixed once written: it is what the audit log and the rotation name. */
    id: slug,
    screen: screenSchema,
    title: z.string().trim().min(3).max(60),
    /** `{coins}` and `{friendCoins}` are filled by the server as it pays. */
    message: z.string().trim().min(3).max(220),
    ctaLabel: z.string().trim().min(2).max(28).optional(),
    accent: accentSchema.optional(),
    /** Under the headline, after the first block, or at the foot of the scroll. */
    position: positionSchema.optional(),
    /** One glyph. Longer than two code points is a sentence, not a mark. */
    emoji: z.string().trim().min(1).max(8).optional(),
    sort: z.number().int().min(-10_000).max(10_000).optional(),
    active: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type ReferralCardBody = z.infer<typeof referralCardBody>;

export const referralCardPatch = referralCardBody.partial().omit({ id: true }).strict();
export type ReferralCardPatch = z.infer<typeof referralCardPatch>;

async function cardRow(id: string) {
  const row = await ReferralPromoModel.findById(id).lean();
  if (!row) throw Errors.notFound('That card');
  return {
    card: {
      id: row._id,
      screen: row.screen,
      title: row.title,
      message: row.message,
      ctaLabel: row.ctaLabel ?? 'Invite friends',
      accent: row.accent ?? 'brand',
      position: row.position ?? 'bottom',
      emoji: row.emoji ?? '🎁',
      sort: row.sort ?? 0,
      active: row.active ?? true,
      createdAt: iso((row as { createdAt?: Date }).createdAt),
      updatedAt: iso((row as { updatedAt?: Date }).updatedAt),
    },
  };
}

/** Writes a card, creating it where the id is new. Idempotent on the id. */
export async function saveReferralCard(actor: string, body: ReferralCardBody) {
  const { id, note, ...fields } = body;
  const before = await ReferralPromoModel.findById(id).lean();

  // `updatedBy` is what stops the next deploy's re-seed overwriting this.
  await ReferralPromoModel.updateOne(
    { _id: id },
    { $set: { ...fields, updatedBy: actor }, $setOnInsert: { _id: id } },
    { upsert: true },
  );
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: before ? 'content.referral_card_updated' : 'content.referral_card_created',
    subjectType: 'referral_promo',
    subjectId: id,
    before: before ? { screen: before.screen, title: before.title, active: before.active } : null,
    after: { ...fields, note: note ?? null },
  });

  return { created: !before, ...(await cardRow(id)) };
}

/** A patch, for the one field somebody came to change — usually `active`. */
export async function patchReferralCard(actor: string, id: string, body: ReferralCardPatch) {
  const before = await ReferralPromoModel.findById(id).lean();
  if (!before) throw Errors.notFound('That card');
  const { note, ...fields } = body;
  if (Object.keys(fields).length > 0) {
    await ReferralPromoModel.updateOne({ _id: id }, { $set: { ...fields, updatedBy: actor } });
  }
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'content.referral_card_updated',
    subjectType: 'referral_promo',
    subjectId: id,
    before: Object.fromEntries(
      Object.keys(fields).map(key => [key, (before as Record<string, unknown>)[key] ?? null]),
    ),
    after: { ...fields, note: note ?? null },
  });
  return cardRow(id);
}

export async function deleteReferralCard(actor: string, id: string, note?: string) {
  const before = await ReferralPromoModel.findById(id).lean();
  if (!before) throw Errors.notFound('That card');
  await ReferralPromoModel.deleteOne({ _id: id });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'content.referral_card_deleted',
    subjectType: 'referral_promo',
    subjectId: id,
    before: { screen: before.screen, title: before.title, message: before.message },
    after: { deleted: true, note: note ?? null },
  });
  return { deleted: true, id };
}
