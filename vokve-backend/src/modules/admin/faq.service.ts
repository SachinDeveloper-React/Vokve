import { z } from 'zod';
import { supportCategorySchema, supportIconSchema, supportTintSchema } from '../../contracts/index.js';
import { Errors } from '../../lib/errors.js';
import { SupportFaqModel, SupportGuideSectionModel } from '../account/models.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * The help centre's own content (RULES P12).
 *
 * The FAQs and the app guide are collections rather than constants for one
 * stated reason — "so support can answer a wave of the same question by
 * writing one row, without waiting for an app release" — and until now
 * there was no way to write that row. The reason the collections exist was
 * the one thing missing.
 *
 * Two rules that are not obvious from the schema:
 *
 *   - **The app validates what it is given.** A guide section's `icon` and
 *     `tint` are parsed against the contract on read (`appGuideSchema`), so
 *     a name the app cannot draw does not make a blank tile — it makes the
 *     *whole guide* fail to parse on the member's phone. Both are closed
 *     lists here for that reason.
 *   - **Deactivating is not deleting, and both are fine here.** Unlike a
 *     shop item, nothing holds a snapshot of an FAQ: no order, no basket,
 *     no ticket points at one. So an article genuinely can be deleted, and
 *     `active: false` is for the one being drafted or withdrawn for a
 *     fortnight.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{1,60}$/, 'An id looks like how-coins-expire — lowercase letters, numbers and hyphens');

// ─── Articles ──────────────────────────────────────────────────────────────

export const faqQuery = z.object({
  /** Words in the question, the answer, or the tags members search by. */
  q: z.string().max(160).default(''),
  category: supportCategorySchema.optional(),
  state: z.enum(['any', 'active', 'hidden']).default('any'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(['shelf', 'newest', 'question']).default('shelf'),
});
export type FaqQuery = z.infer<typeof faqQuery>;

export async function listFaqs(query: FaqQuery) {
  const filter: Record<string, unknown> = {};
  const trimmed = query.q.trim();
  if (trimmed) {
    const like = new RegExp(escape(trimmed), 'i');
    filter.$or = [{ _id: like }, { question: like }, { answer: like }, { tags: like }];
  }
  if (query.category) filter.category = query.category;
  if (query.state === 'active') filter.active = true;
  if (query.state === 'hidden') filter.active = false;

  const order: Record<string, 1 | -1> =
    query.sort === 'newest' ? { createdAt: -1 } : query.sort === 'question' ? { question: 1 } : { sort: 1, _id: 1 };

  const [rows, total, byCategory] = await Promise.all([
    SupportFaqModel.find(filter).sort(order).skip(query.offset).limit(query.limit).lean(),
    SupportFaqModel.countDocuments(filter),
    SupportFaqModel.aggregate<{ _id: string; articles: number; active: number }>([
      { $group: { _id: '$category', articles: { $sum: 1 }, active: { $sum: { $cond: ['$active', 1, 0] } } } },
      { $sort: { articles: -1 } },
    ]),
  ]);

  return {
    total,
    offset: query.offset,
    limit: query.limit,
    /** The shelves the help centre can file an article under. */
    categories: supportCategorySchema.options,
    byCategory: byCategory.map(row => ({ category: row._id, articles: row.articles, active: row.active })),
    totals: {
      articles: total,
      active: byCategory.reduce((sum, row) => sum + row.active, 0),
      /** Shelves with nothing on them: a help page row that opens an empty list. */
      emptyCategories: supportCategorySchema.options.filter(
        category => !byCategory.some(row => row._id === category && row.active > 0),
      ),
    },
    data: rows.map(row => ({
      id: row._id,
      category: row.category,
      question: row.question,
      answer: row.answer,
      tags: row.tags ?? [],
      sort: row.sort ?? 0,
      active: row.active ?? true,
      createdAt: iso((row as { createdAt?: Date }).createdAt),
      updatedAt: iso((row as { updatedAt?: Date }).updatedAt),
    })),
    nextCursor: null,
  };
}

export const faqBody = z
  .object({
    /** The id members' deep links and our own notes use. Fixed once written. */
    id: slug,
    category: supportCategorySchema,
    question: z.string().trim().min(5).max(200),
    answer: z.string().trim().min(5).max(4000),
    /** What members call it, not what we do — the search matches these too. */
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    sort: z.number().int().min(-10_000).max(10_000).optional(),
    active: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type FaqBody = z.infer<typeof faqBody>;

export const faqPatch = faqBody.partial().omit({ id: true }).strict();
export type FaqPatch = z.infer<typeof faqPatch>;

async function faqOf(id: string) {
  const page = await listFaqs({ q: id, state: 'any', limit: 100, offset: 0, sort: 'shelf' });
  const article = page.data.find(row => row.id === id);
  if (!article) throw Errors.notFound('That article');
  return { article };
}

/** Writes an article, creating it where the id is new. Idempotent on the id. */
export async function saveFaq(actor: string, body: FaqBody) {
  const { id, note, ...fields } = body;
  const before = await SupportFaqModel.findById(id).lean();

  await SupportFaqModel.updateOne({ _id: id }, { $set: fields, $setOnInsert: { _id: id } }, { upsert: true });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: before ? 'support.faq_updated' : 'support.faq_created',
    subjectType: 'support_faq',
    subjectId: id,
    before: before ? { question: before.question, category: before.category, active: before.active } : null,
    after: { ...fields, note: note ?? null },
  });

  return { created: !before, ...(await faqOf(id)) };
}

/** A patch, for the one field somebody came to change — usually `active`. */
export async function patchFaq(actor: string, id: string, body: FaqPatch) {
  const before = await SupportFaqModel.findById(id).lean();
  if (!before) throw Errors.notFound('That article');
  const { note, ...fields } = body;
  if (Object.keys(fields).length > 0) {
    await SupportFaqModel.updateOne({ _id: id }, { $set: fields });
  }
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'support.faq_updated',
    subjectType: 'support_faq',
    subjectId: id,
    before: Object.fromEntries(Object.keys(fields).map(key => [key, (before as Record<string, unknown>)[key] ?? null])),
    after: { ...fields, note: note ?? null },
  });
  return faqOf(id);
}

/**
 * Deletes an article.
 *
 * Nothing holds a snapshot of one — no ticket, no order, no basket points at
 * an FAQ — so this is a real delete rather than the retire a shop item gets.
 * Hiding it (`active: false`) is the other option, and it is the right one
 * for an answer that is wrong today and will be right next week.
 */
export async function deleteFaq(actor: string, id: string, note?: string) {
  const before = await SupportFaqModel.findById(id).lean();
  if (!before) throw Errors.notFound('That article');
  await SupportFaqModel.deleteOne({ _id: id });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'support.faq_deleted',
    subjectType: 'support_faq',
    subjectId: id,
    before: { category: before.category, question: before.question, answer: before.answer },
    after: { deleted: true, note: note ?? null },
  });
  return { deleted: true, id };
}

// ─── The guide ─────────────────────────────────────────────────────────────

export async function listGuide() {
  const rows = await SupportGuideSectionModel.find().sort({ sort: 1, _id: 1 }).lean();
  return {
    /** Closed lists, because the app parses both and refuses what it cannot draw. */
    icons: supportIconSchema.options,
    tints: supportTintSchema.options,
    totals: {
      sections: rows.length,
      active: rows.filter(row => row.active !== false).length,
      steps: rows.reduce((sum, row) => sum + (row.steps?.length ?? 0), 0),
    },
    data: rows.map(row => ({
      id: row._id,
      title: row.title,
      summary: row.summary ?? '',
      icon: row.icon ?? 'guide',
      tint: row.tint ?? 'primary',
      steps: (row.steps ?? []).map(step => ({ title: step.title, body: step.body })),
      sort: row.sort ?? 0,
      active: row.active ?? true,
      createdAt: iso((row as { createdAt?: Date }).createdAt),
      updatedAt: iso((row as { updatedAt?: Date }).updatedAt),
    })),
    nextCursor: null,
  };
}

export const guideBody = z
  .object({
    id: slug,
    title: z.string().trim().min(3).max(120),
    summary: z.string().trim().max(300).optional(),
    /** Validated against the contract, because the app parses the whole guide. */
    icon: supportIconSchema.optional(),
    tint: supportTintSchema.optional(),
    steps: z
      .array(z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(1000) }).strict())
      .min(1, 'A chapter with no steps is a heading')
      .max(30),
    sort: z.number().int().min(-10_000).max(10_000).optional(),
    active: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type GuideBody = z.infer<typeof guideBody>;

/** Writes a chapter of the guide, creating it where the id is new. */
export async function saveGuideSection(actor: string, body: GuideBody) {
  const { id, note, ...fields } = body;
  const before = await SupportGuideSectionModel.findById(id).lean();

  await SupportGuideSectionModel.updateOne({ _id: id }, { $set: fields, $setOnInsert: { _id: id } }, { upsert: true });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: before ? 'support.guide_updated' : 'support.guide_created',
    subjectType: 'support_guide',
    subjectId: id,
    before: before ? { title: before.title, steps: (before.steps ?? []).length, active: before.active } : null,
    after: { ...fields, steps: fields.steps.length, note: note ?? null },
  });

  return { created: !before, ...(await listGuide()) };
}

export async function deleteGuideSection(actor: string, id: string, note?: string) {
  const before = await SupportGuideSectionModel.findById(id).lean();
  if (!before) throw Errors.notFound('That chapter');
  await SupportGuideSectionModel.deleteOne({ _id: id });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'support.guide_deleted',
    subjectType: 'support_guide',
    subjectId: id,
    before: { title: before.title, steps: (before.steps ?? []).length },
    after: { deleted: true, note: note ?? null },
  });
  return { deleted: true, id };
}
