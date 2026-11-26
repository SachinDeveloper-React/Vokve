import { z } from 'zod';
import { SITE_ICONS, siteDocumentEditSchema, siteDocumentSlugSchema } from '../../contracts/site.js';
import { Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { refreshWebsite, type WebsiteRefresh } from '../../lib/website.js';
import { env } from '../../config/env.js';
import { SupportFaqModel } from '../account/models.js';
import { AuditLogModel } from '../platform/models.js';
import { SITE_DOCUMENT_DEFAULTS } from './defaults/index.js';
import { SiteDocumentModel, SiteEnquiryModel, SitePageModel, SiteRevisionModel } from './models.js';
import {
  RESERVED_SLUGS,
  SITE_PAGE_KEYS,
  SITE_PAGES,
  knownTokens,
  loadDocument,
  loadDocuments,
  loadPage,
  tokenGuide,
  unknownTokens,
  type LoadedDocument,
  type SitePageKey,
} from './service.js';

/**
 * The panel's half of the website (RULES P22): read a page with everything
 * its editor needs, save it, put it back, and the same for documents —
 * each save checked against the shape the website parses, refused when it
 * names a token nobody fills, refused when somebody else saved since it was
 * opened, written down in the page's history, and followed by asking the
 * website to drop its cached copy.
 */

/** How many saved versions of one page or document are kept for History. */
export const SITE_REVISIONS_KEPT = 50;

const iso = (at: Date | null | undefined) => at?.toISOString() ?? null;

/** The page's form, drawn by the panel from the shape itself. */
function editorSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
}

/**
 * zod's refusal, in the words the panel shows under the box. Its own
 * messages are written for programmers ("Too small: expected string to have
 * >=1 characters"); a person editing a headline needs "Cannot be empty."
 * A message a refine wrote itself is already a sentence and is kept.
 */
export function plainIssue(issue: z.core.$ZodIssue): string {
  const i = issue as z.core.$ZodIssue & {
    origin?: string;
    minimum?: number | bigint;
    maximum?: number | bigint;
    expected?: string;
    input?: unknown;
    format?: string;
    includes?: string;
    values?: unknown[];
  };
  const n = (value: number | bigint | undefined) => Number(value ?? 0);
  switch (i.code) {
    case 'too_small':
      if (i.origin === 'string') return n(i.minimum) <= 1 ? 'Cannot be empty.' : `At least ${n(i.minimum)} characters.`;
      if (i.origin === 'array') return n(i.minimum) <= 1 ? 'Needs at least one.' : `Needs at least ${n(i.minimum)}.`;
      return `At least ${n(i.minimum)}.`;
    case 'too_big':
      if (i.origin === 'string') return `At most ${n(i.maximum)} characters.`;
      return `At most ${n(i.maximum)}.`;
    case 'invalid_type':
      return i.input === undefined ? 'Missing.' : `Should be ${i.expected === 'string' ? 'text' : i.expected === 'array' ? 'a list' : i.expected}.`;
    case 'invalid_format':
      if (i.format === 'url') return 'Must be a full web address, starting https://';
      if (i.format === 'email') return 'Must be an email address.';
      if (i.format === 'includes') return `Must include “${i.includes}”.`;
      return i.message.startsWith('Invalid') ? 'Not in the right form.' : i.message;
    case 'invalid_value':
      return `Must be one of: ${(i.values ?? []).map(String).join(', ')}.`;
    default:
      return i.message;
  }
}

function issues(error: z.ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    details[key] ??= plainIssue(issue);
  }
  return details;
}

async function validateContent(schema: z.ZodType, content: unknown) {
  const parsed = schema.safeParse(content);
  if (!parsed.success) throw Errors.validation(issues(parsed.error));
  const strays = unknownTokens(parsed.data, await knownTokens());
  if (Object.keys(strays).length > 0) throw Errors.validation(strays);
  return parsed.data as Record<string, unknown>;
}

function conflict(current: number, updatedBy: string | null, updatedAt: Date) {
  return Errors.conflict(
    'SITE_EDIT_CONFLICT',
    `Somebody else saved this since you opened it${updatedBy ? ` (${updatedBy})` : ''}. Reload to see their version, then make your change again.`,
    { revision: current, updatedBy, updatedAt: updatedAt.toISOString() },
  );
}

async function recordRevision(target: string, revision: number, content: unknown, action: string, savedBy: string, note?: string | null) {
  await SiteRevisionModel.create({ _id: newId('srev'), target, revision, content, action, savedBy, note: note ?? null });
  const stale = await SiteRevisionModel.find({ target }, { _id: 1 }).sort({ at: -1, revision: -1 }).skip(SITE_REVISIONS_KEPT).lean();
  if (stale.length > 0) await SiteRevisionModel.deleteMany({ _id: { $in: stale.map(row => row._id) } });
}

/**
 * The number the next save takes. Counted on from History rather than from
 * the row, so a page put back to its shipped copy (which has no row) and
 * then saved again does not start at 1 a second time beside the old 1.
 */
async function nextRevision(target: string, current: number): Promise<number> {
  const last = await SiteRevisionModel.findOne({ target }, { revision: 1 }).sort({ revision: -1 }).lean();
  return Math.max(current, last?.revision ?? 0) + 1;
}

async function audit(actor: string, action: string, subjectId: string, after: Record<string, unknown>) {
  await AuditLogModel.create({ actorType: 'admin', actorId: actor, action, subjectType: 'site', subjectId, before: null, after });
}

// ─── Overview ──────────────────────────────────────────────────────────────

export async function siteOverview() {
  const [pages, docs, byStatus] = await Promise.all([
    Promise.all(SITE_PAGE_KEYS.map(async key => ({ key, loaded: await loadPage(key) }))),
    loadDocuments(),
    SiteEnquiryModel.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  const config = pages.find(page => page.key === 'config')!.loaded.content as { seo: { siteUrl: string } };
  const counts = Object.fromEntries(byStatus.map(row => [row._id, row.count]));
  return {
    siteUrl: config.seo.siteUrl,
    /** Whether a save reaches the website at once, or within its hour. */
    refresh: env.SITE_REVALIDATE_URL && env.SITE_REVALIDATE_SECRET ? 'on' : 'off',
    pages: pages.map(({ key, loaded }) => ({
      key,
      label: SITE_PAGES[key].label,
      path: SITE_PAGES[key].path,
      caption: SITE_PAGES[key].caption,
      isDefault: loaded.isDefault,
      invalid: loaded.invalid,
      revision: loaded.revision,
      updatedAt: iso(loaded.updatedAt),
      updatedBy: loaded.updatedBy,
    })),
    documents: docs.map(documentRow),
    enquiries: {
      new: counts.new ?? 0,
      open: counts.open ?? 0,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    },
  };
}

function documentRow(doc: LoadedDocument) {
  return {
    slug: doc.slug,
    path: `/${doc.slug}`,
    title: doc.content.title,
    published: doc.content.published,
    listed: doc.content.listing.show,
    version: doc.content.version,
    effectiveAt: doc.content.effectiveAt,
    shownUpdatedAt: doc.content.updatedAt,
    shipped: doc.shipped,
    core: doc.core,
    isDefault: doc.isDefault,
    invalid: doc.invalid,
    revision: doc.revision,
    updatedAt: iso(doc.updatedAt),
    updatedBy: doc.updatedBy,
  };
}

// ─── Pages ─────────────────────────────────────────────────────────────────

export function pageSpec(key: string) {
  if (!(SITE_PAGE_KEYS as readonly string[]).includes(key)) throw Errors.notFound('That page');
  return key as SitePageKey;
}

export async function pageForEdit(key: SitePageKey) {
  const spec = SITE_PAGES[key];
  const [loaded, tokens, faqs] = await Promise.all([
    loadPage(key),
    tokenGuide(),
    key === 'home'
      ? SupportFaqModel.find({}, { question: 1, category: 1, active: 1, website: 1, sort: 1 }).sort({ category: 1, sort: 1, _id: 1 }).lean()
      : Promise.resolve([]),
  ]);
  return {
    key,
    label: spec.label,
    path: spec.path,
    caption: spec.caption,
    content: loaded.content,
    revision: loaded.revision,
    isDefault: loaded.isDefault,
    invalid: loaded.invalid,
    updatedAt: iso(loaded.updatedAt),
    updatedBy: loaded.updatedBy,
    schema: editorSchema(spec.schema),
    icons: SITE_ICONS,
    tokens,
    faqOptions: faqs.map(row => ({
      id: String(row._id),
      question: row.question,
      category: row.category,
      active: row.active !== false,
      /** Off: kept to the app, so the website leaves it out even when picked. */
      website: row.website !== false,
    })),
  };
}

export const pageSaveBody = z
  .object({
    content: z.record(z.string(), z.unknown()),
    /** The revision the editor opened; a save over anything newer is refused. */
    revision: z.number().int().min(0),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export async function savePage(actor: string, key: SitePageKey, body: z.infer<typeof pageSaveBody>, action: 'saved' | 'restored' = 'saved') {
  const spec = SITE_PAGES[key];
  const content = await validateContent(spec.schema, body.content);
  const current = await loadPage(key);
  if (current.revision !== body.revision) throw conflict(current.revision, current.updatedBy, current.updatedAt);

  const revision = await nextRevision(`page:${key}`, current.revision);
  const written = await SitePageModel.updateOne(
    { _id: key, ...(current.isDefault ? { revision: { $exists: false } } : { revision: current.revision }) },
    { $set: { content, revision, updatedBy: actor } },
    { upsert: current.isDefault },
  ).catch((error: unknown) => {
    // Two first saves at once: the second upsert meets the first's row.
    if ((error as { code?: number }).code === 11000) return { matchedCount: 0, upsertedCount: 0 };
    throw error;
  });
  if (written.matchedCount === 0 && (written as { upsertedCount?: number }).upsertedCount === 0) {
    const now = await loadPage(key);
    throw conflict(now.revision, now.updatedBy, now.updatedAt);
  }

  await recordRevision(`page:${key}`, revision, content, action, actor, body.note);
  await audit(actor, `site.page_${action}`, key, { revision, note: body.note ?? null });
  const website = await refreshWebsite(spec.tags);
  return { ...(await pageForEdit(key)), website };
}

export const resetBody = z
  .object({ revision: z.number().int().min(0), note: z.string().trim().max(300).optional() })
  .strict();

/** Back to the shipped copy: the saved row goes, and History keeps what it said. */
export async function resetPage(actor: string, key: SitePageKey, body: z.infer<typeof resetBody>) {
  const current = await loadPage(key);
  if (current.isDefault) return { ...(await pageForEdit(key)), website: null as WebsiteRefresh | null };
  if (current.revision !== body.revision) throw conflict(current.revision, current.updatedBy, current.updatedAt);
  await SitePageModel.deleteOne({ _id: key, revision: current.revision });
  await recordRevision(`page:${key}`, await nextRevision(`page:${key}`, current.revision), null, 'reset', actor, body.note);
  await audit(actor, 'site.page_reset', key, { note: body.note ?? null });
  const website = await refreshWebsite(SITE_PAGES[key].tags);
  return { ...(await pageForEdit(key)), website };
}

export async function revisions(target: string) {
  const rows = await SiteRevisionModel.find({ target }, { content: 0 }).sort({ at: -1, revision: -1 }).lean();
  return {
    kept: SITE_REVISIONS_KEPT,
    data: rows.map(row => ({
      id: row._id,
      revision: row.revision,
      action: row.action,
      savedBy: row.savedBy,
      note: row.note ?? null,
      at: iso((row as { at?: Date }).at),
    })),
  };
}

export const restoreBody = z
  .object({
    /** The history entry to put back. */
    id: z.string().min(1),
    /** The revision the editor has open, as for a save. */
    revision: z.number().int().min(0),
  })
  .strict();

async function revisionRow(target: string, id: string) {
  const row = await SiteRevisionModel.findOne({ _id: id, target }).lean();
  if (!row) throw Errors.notFound('That version');
  return row;
}

export async function restorePage(actor: string, key: SitePageKey, body: z.infer<typeof restoreBody>) {
  const row = await revisionRow(`page:${key}`, body.id);
  const note = `Restored the version of ${iso((row as { at?: Date }).at)?.slice(0, 16).replace('T', ' ')} UTC (revision ${row.revision})`;
  if (row.content === null) return resetPage(actor, key, { revision: body.revision, note });
  return savePage(actor, key, { content: row.content as Record<string, unknown>, revision: body.revision, note }, 'restored');
}

// ─── Documents ─────────────────────────────────────────────────────────────

const documentTags = (slug: string) => ['site:legal', `site:legal:${slug}`];

export async function listDocuments() {
  return { data: (await loadDocuments()).map(documentRow), reserved: [...RESERVED_SLUGS].sort() };
}

async function requireDocument(slug: string) {
  const doc = await loadDocument(slug);
  if (!doc) {
    // A created document whose saved copy no longer fits still has a row:
    // the editor must be able to open it to fix it.
    const row = await SiteDocumentModel.findById(slug).lean();
    if (!row) throw Errors.notFound('That document');
    const parsed = siteDocumentEditSchema.safeParse(row.content);
    return {
      slug,
      shipped: false,
      core: false,
      content: (parsed.success ? parsed.data : row.content) as LoadedDocument['content'],
      revision: row.revision,
      isDefault: false,
      updatedAt: (row as { updatedAt?: Date }).updatedAt ?? new Date(),
      updatedBy: row.updatedBy,
      invalid: parsed.success ? null : z.prettifyError(parsed.error),
      createdAt: (row as { createdAt?: Date }).createdAt ?? null,
    } satisfies LoadedDocument;
  }
  return doc;
}

export async function documentForEdit(slug: string) {
  const [doc, tokens] = await Promise.all([requireDocument(slug), tokenGuide()]);
  return {
    ...documentRow(doc),
    content: doc.content,
    schema: editorSchema(siteDocumentEditSchema),
    icons: SITE_ICONS,
    tokens,
  };
}

export const documentCreateBody = z
  .object({
    slug: siteDocumentSlugSchema,
    title: z.string().trim().min(1).max(120),
    /** Start from a copy of another document's text instead of a blank page. */
    copyFrom: z.string().trim().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

const today = () => new Date().toISOString().slice(0, 10);

/** A new document starts hidden, so a half-written page is never live by accident. */
export async function createDocument(actor: string, body: z.infer<typeof documentCreateBody>) {
  const slug = body.slug;
  if (RESERVED_SLUGS.has(slug)) {
    throw Errors.validation({ slug: `/${slug} is one of the site’s own pages. Pick another address.` });
  }
  if (SITE_DOCUMENT_DEFAULTS[slug] || (await SiteDocumentModel.exists({ _id: slug }))) {
    throw Errors.conflict('SITE_DOCUMENT_EXISTS', `There is already a document at /${slug}.`);
  }

  let start: Record<string, unknown> = {
    eyebrow: 'Legal',
    summary: '',
    version: '1.0',
    effectiveAt: today(),
    updatedAt: today(),
    highlights: [],
    sections: [{ id: 'introduction', title: 'Introduction', blocks: [{ type: 'paragraph', text: 'Write the first paragraph here.' }] }],
    listing: { show: true, summary: '', icon: 'file-text', sort: 10 },
  };
  if (body.copyFrom) {
    const source = await requireDocument(body.copyFrom);
    start = { ...source.content, effectiveAt: today(), updatedAt: today() };
  }
  const content = await validateContent(siteDocumentEditSchema, { ...start, title: body.title, published: false });

  const revision = await nextRevision(`doc:${slug}`, 0);
  await SiteDocumentModel.create({ _id: slug, content, revision, updatedBy: actor });
  await recordRevision(`doc:${slug}`, revision, content, 'created', actor, body.note);
  await audit(actor, 'site.document_created', slug, { title: body.title, copyFrom: body.copyFrom ?? null });
  return { ...(await documentForEdit(slug)), website: null as WebsiteRefresh | null };
}

export const documentSaveBody = pageSaveBody;

export async function saveDocument(actor: string, slug: string, body: z.infer<typeof documentSaveBody>, action: 'saved' | 'restored' = 'saved') {
  const current = await requireDocument(slug);
  const content = (await validateContent(siteDocumentEditSchema, body.content)) as LoadedDocument['content'];
  if (current.core && !content.published) {
    throw Errors.validation({ published: `The ${current.content.title} is linked from the app and the store listings, so it cannot be hidden.` });
  }
  if (current.revision !== body.revision) throw conflict(current.revision, current.updatedBy, current.updatedAt);

  const revision = await nextRevision(`doc:${slug}`, current.revision);
  const written = await SiteDocumentModel.updateOne(
    { _id: slug, ...(current.isDefault ? { revision: { $exists: false } } : { revision: current.revision }) },
    { $set: { content, revision, updatedBy: actor } },
    { upsert: current.isDefault },
  ).catch((error: unknown) => {
    if ((error as { code?: number }).code === 11000) return { matchedCount: 0, upsertedCount: 0 };
    throw error;
  });
  if (written.matchedCount === 0 && (written as { upsertedCount?: number }).upsertedCount === 0) {
    const now = await requireDocument(slug);
    throw conflict(now.revision, now.updatedBy, now.updatedAt);
  }

  await recordRevision(`doc:${slug}`, revision, content, action, actor, body.note);
  await audit(actor, `site.document_${action}`, slug, { revision, published: content.published, note: body.note ?? null });
  const website = await refreshWebsite(documentTags(slug));
  return { ...(await documentForEdit(slug)), website };
}

export const documentDeleteBody = z
  .object({
    /** The address typed again, so a stray click cannot take a policy off the site. */
    confirm: z.string().trim(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

/**
 * A shipped document cannot be deleted — it would come straight back from
 * the defaults — so it is hidden instead; the two core ones cannot be
 * hidden either. A created one goes, and History keeps its last words.
 */
export async function deleteDocument(actor: string, slug: string, body: z.infer<typeof documentDeleteBody>) {
  const current = await requireDocument(slug);
  if (current.shipped) {
    throw Errors.conflict(
      'SITE_DOCUMENT_SHIPPED',
      current.core
        ? `The ${current.content.title} is required by the app and the stores, so it stays. Edit it instead.`
        : `The ${current.content.title} shipped with the site and cannot be deleted. Switch “Published” off to take it down.`,
    );
  }
  if (body.confirm !== slug) throw Errors.validation({ confirm: `Type ${slug} to confirm.` });
  await SiteDocumentModel.deleteOne({ _id: slug });
  await recordRevision(`doc:${slug}`, await nextRevision(`doc:${slug}`, current.revision), current.content, 'deleted', actor, body.note);
  await audit(actor, 'site.document_deleted', slug, { title: current.content.title, note: body.note ?? null });
  const website = await refreshWebsite(documentTags(slug));
  return { deleted: true, slug, website };
}

/** A shipped document back to its shipped words. */
export async function resetDocument(actor: string, slug: string, body: z.infer<typeof resetBody>) {
  const current = await requireDocument(slug);
  if (!current.shipped) throw Errors.conflict('SITE_DOCUMENT_NOT_SHIPPED', 'This document was written here; there is no shipped copy to go back to.');
  if (current.isDefault) return { ...(await documentForEdit(slug)), website: null as WebsiteRefresh | null };
  if (current.revision !== body.revision) throw conflict(current.revision, current.updatedBy, current.updatedAt);
  await SiteDocumentModel.deleteOne({ _id: slug, revision: current.revision });
  await recordRevision(`doc:${slug}`, await nextRevision(`doc:${slug}`, current.revision), null, 'reset', actor, body.note);
  await audit(actor, 'site.document_reset', slug, { note: body.note ?? null });
  const website = await refreshWebsite(documentTags(slug));
  return { ...(await documentForEdit(slug)), website };
}

export async function restoreDocument(actor: string, slug: string, body: z.infer<typeof restoreBody>) {
  const row = await revisionRow(`doc:${slug}`, body.id);
  const note = `Restored the version of ${iso((row as { at?: Date }).at)?.slice(0, 16).replace('T', ' ')} UTC (revision ${row.revision})`;
  if (row.content === null) return resetDocument(actor, slug, { revision: body.revision, note });
  return saveDocument(actor, slug, { content: row.content as Record<string, unknown>, revision: body.revision, note }, 'restored');
}

/** Asks the website to re-read everything now — after a deploy, or when in doubt. */
export async function refreshWholeSite(actor: string) {
  const website = await refreshWebsite(['site']);
  await audit(actor, 'site.refreshed', 'site', { website });
  return { website };
}

