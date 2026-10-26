import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { CONTENT_TOPICS, ContentTipModel } from '../content/models.js';
import { tipOfTheDay } from '../content/service.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * The lines the app says in its own voice (BACKEND §6.15).
 *
 * Every screen with something encouraging on it — the home card's quote, the
 * tip beside the water log, the reminder plan's note, the two vital screens'
 * advice — draws it from `content_tips`, one per topic per day in rotation.
 * That was always the design, and it was always *seeded*: the only way to
 * change a quote a member reads every seventh day was a deploy. This is the
 * missing half, so the words belong to whoever is writing them.
 *
 * Three things worth knowing:
 *
 *   - **A topic is a place in the app, not a label.** `CONTENT_TOPICS` is a
 *     closed list because each one is a card on a screen that was built for
 *     it; a new topic needs an app release, and an id that is not on the
 *     list would simply never be read. So the list is served with the rows,
 *     and the panel offers nothing else.
 *   - **Rotation is by the day, not at random.** The member sees the same
 *     line all day and the next one tomorrow, round the topic's active tips
 *     in `sort` order — which is why `sort` is worth setting and why the
 *     panel shows what today's line actually is before anybody edits it.
 *   - **Nothing holds a snapshot of a tip.** No order, no ticket, no log
 *     points at one, so a tip can genuinely be deleted. `active: false` is
 *     for the line being drafted, or withdrawn for a fortnight.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const topicSchema = z.enum(CONTENT_TOPICS);

const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{1,60}$/, 'An id looks like motivation-6 — lowercase letters, numbers and hyphens');

export const tipQuery = z.object({
  /** Words in the line, its heading, or its id. */
  q: z.string().max(200).default(''),
  topic: topicSchema.optional(),
  state: z.enum(['any', 'active', 'hidden']).default('any'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(['rotation', 'newest', 'text']).default('rotation'),
});
export type TipQuery = z.infer<typeof tipQuery>;

/**
 * What each screen is actually saying today.
 *
 * The one thing an operator cannot work out from a list of rows: the
 * rotation is a function of the day and the number of active lines, so
 * "which of these fourteen is on the home screen right now" is a question
 * only the server can answer — and it is the first question anybody asks.
 * A topic with nothing active answers null, which is also what the app
 * draws: no card at all.
 */
async function todayByTopic(timeZone: string, now: Date): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    CONTENT_TOPICS.map(async topic => {
      try {
        const tip = await tipOfTheDay(topic, timeZone, now);
        return [topic, tip.id] as const;
      } catch {
        return [topic, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

export async function listTips(query: TipQuery, timeZone: string, now = new Date()) {
  const filter: Record<string, unknown> = {};
  const trimmed = query.q.trim();
  if (trimmed) {
    const like = new RegExp(escape(trimmed), 'i');
    filter.$or = [{ _id: like }, { text: like }, { title: like }];
  }
  if (query.topic) filter.topic = query.topic;
  if (query.state === 'active') filter.active = true;
  if (query.state === 'hidden') filter.active = false;

  const order: Record<string, 1 | -1> =
    query.sort === 'newest' ? { createdAt: -1 } : query.sort === 'text' ? { text: 1 } : { topic: 1, sort: 1, _id: 1 };

  const [rows, total, byTopic, today] = await Promise.all([
    ContentTipModel.find(filter).sort(order).skip(query.offset).limit(query.limit).lean(),
    ContentTipModel.countDocuments(filter),
    ContentTipModel.aggregate<{ _id: string; lines: number; active: number }>([
      { $group: { _id: '$topic', lines: { $sum: 1 }, active: { $sum: { $cond: ['$active', 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    todayByTopic(timeZone, now),
  ]);

  return {
    total,
    offset: query.offset,
    limit: query.limit,
    /** The places in the app a line can be written for. Closed: see the header. */
    topics: CONTENT_TOPICS,
    byTopic: CONTENT_TOPICS.map(topic => {
      const row = byTopic.find(entry => entry._id === topic);
      return {
        topic,
        lines: row?.lines ?? 0,
        active: row?.active ?? 0,
        /** The id on that screen today, or null where the card is not drawn at all. */
        todayId: today[topic] ?? null,
      };
    }),
    totals: {
      lines: total,
      active: byTopic.reduce((sum, row) => sum + row.active, 0),
      /** Topics with nothing live: a screen whose card is simply missing. */
      silentTopics: CONTENT_TOPICS.filter(topic => today[topic] === null),
    },
    data: rows.map(row => ({
      id: row._id,
      topic: row.topic,
      title: row.title ?? null,
      text: row.text,
      sort: row.sort ?? 0,
      active: row.active ?? true,
      /** True for the line that is on that screen today. */
      showingToday: today[row.topic] === row._id,
      createdAt: iso((row as { createdAt?: Date }).createdAt),
      updatedAt: iso((row as { updatedAt?: Date }).updatedAt),
    })),
    nextCursor: null,
  };
}

export const tipBody = z
  .object({
    /** Fixed once written: it is what the audit log and the rotation name. */
    id: slug,
    topic: topicSchema,
    /**
     * The heading, where the card has one. Null for the quote cards, which
     * are a line and nothing else — a heading on one of those would be
     * drawn over the quote it is meant to be.
     */
    title: z.string().trim().max(120).nullable().optional(),
    text: z.string().trim().min(3).max(600),
    sort: z.number().int().min(-10_000).max(10_000).optional(),
    active: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type TipBody = z.infer<typeof tipBody>;

export const tipPatch = tipBody.partial().omit({ id: true }).strict();
export type TipPatch = z.infer<typeof tipPatch>;

async function tipRow(id: string) {
  const row = await ContentTipModel.findById(id).lean();
  if (!row) throw Errors.notFound('That line');
  return {
    tip: {
      id: row._id,
      topic: row.topic,
      title: row.title ?? null,
      text: row.text,
      sort: row.sort ?? 0,
      active: row.active ?? true,
      createdAt: iso((row as { createdAt?: Date }).createdAt),
      updatedAt: iso((row as { updatedAt?: Date }).updatedAt),
    },
  };
}

/** Writes a line, creating it where the id is new. Idempotent on the id. */
export async function saveTip(actor: string, body: TipBody) {
  const { id, note, ...fields } = body;
  const before = await ContentTipModel.findById(id).lean();

  await ContentTipModel.updateOne(
    { _id: id },
    { $set: { ...fields, ...(fields.title === undefined ? {} : { title: fields.title }) }, $setOnInsert: { _id: id } },
    { upsert: true },
  );
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: before ? 'content.tip_updated' : 'content.tip_created',
    subjectType: 'content_tip',
    subjectId: id,
    before: before ? { topic: before.topic, text: before.text, active: before.active } : null,
    after: { ...fields, note: note ?? null },
  });

  return { created: !before, ...(await tipRow(id)) };
}

/** A patch, for the one field somebody came to change — usually `active`. */
export async function patchTip(actor: string, id: string, body: TipPatch) {
  const before = await ContentTipModel.findById(id).lean();
  if (!before) throw Errors.notFound('That line');
  const { note, ...fields } = body;
  if (Object.keys(fields).length > 0) {
    await ContentTipModel.updateOne({ _id: id }, { $set: fields });
  }
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'content.tip_updated',
    subjectType: 'content_tip',
    subjectId: id,
    before: Object.fromEntries(Object.keys(fields).map(key => [key, (before as Record<string, unknown>)[key] ?? null])),
    after: { ...fields, note: note ?? null },
  });
  return tipRow(id);
}

export async function deleteTip(actor: string, id: string, note?: string) {
  const before = await ContentTipModel.findById(id).lean();
  if (!before) throw Errors.notFound('That line');
  await ContentTipModel.deleteOne({ _id: id });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'content.tip_deleted',
    subjectType: 'content_tip',
    subjectId: id,
    before: { topic: before.topic, title: before.title ?? null, text: before.text },
    after: { deleted: true, note: note ?? null },
  });
  return { deleted: true, id };
}

/**
 * Several lines for one topic at once — the "paste the list" case.
 *
 * Writing quotes is not a one-at-a-time job: somebody arrives with twenty
 * of them in a document, and a form that takes one at a time turns that
 * into twenty round trips and twenty ids to invent. Each line is given the
 * next free number for its topic (`motivation-6`, `motivation-7`, …) and
 * added at the end of the rotation, so the ones already there keep their
 * place in it.
 *
 * A line the topic already holds, word for word, is skipped rather than
 * written twice: a list pasted twice is the same list.
 */
export const tipsBody = z
  .object({
    topic: topicSchema,
    lines: z
      .array(
        z
          .object({
            title: z.string().trim().max(120).nullable().optional(),
            text: z.string().trim().min(3).max(600),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    active: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type TipsBody = z.infer<typeof tipsBody>;

export async function addTips(actor: string, body: TipsBody) {
  const existing = await ContentTipModel.find({ topic: body.topic }, { _id: 1, text: 1, sort: 1 }).lean<
    { _id: string; text: string; sort?: number }[]
  >();
  const already = new Set(existing.map(row => row.text.trim().toLowerCase()));
  const used = new Set(existing.map(row => row._id));
  let nextNumber = existing.reduce((highest, row) => {
    const match = new RegExp(`^${body.topic.replace(/_/g, '[-_]')}-(\\d+)$`).exec(row._id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  let nextSort = existing.reduce((highest, row) => Math.max(highest, row.sort ?? 0), 0);

  const added: string[] = [];
  let skipped = 0;
  for (const line of body.lines) {
    const key = line.text.trim().toLowerCase();
    if (already.has(key)) {
      skipped += 1;
      continue;
    }
    already.add(key);
    // `heart_rate` would make `heart_rate-1`, and the id pattern is
    // hyphens only — the seeded ids read `heart-rate-1` for the same reason.
    const stem = body.topic.replace(/_/g, '-');
    do {
      nextNumber += 1;
    } while (used.has(`${stem}-${nextNumber}`));
    const id = `${stem}-${nextNumber}`;
    used.add(id);
    nextSort += 1;
    await ContentTipModel.updateOne(
      { _id: id },
      {
        $set: {
          topic: body.topic,
          title: line.title ?? null,
          text: line.text,
          sort: nextSort,
          active: body.active ?? true,
        },
        $setOnInsert: { _id: id },
      },
      { upsert: true },
    );
    added.push(id);
  }

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'content.tips_added',
    subjectType: 'content_tip',
    subjectId: body.topic,
    before: null,
    after: { added: added.length, skipped, ids: added.slice(0, 50), note: body.note ?? null },
  });

  return { added: added.length, skipped, ids: added };
}
