import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import {
  aboutEditSchema,
  aboutPageSchema,
  contactEditSchema,
  contactPageSchema,
  deletionEditSchema,
  deletionGuideSchema,
  faqEditSchema,
  faqPageSchema,
  homeEditSchema,
  homePageSchema,
  inviteEditSchema,
  invitePageSchema,
  legalDocumentSchema,
  legalIndexEditSchema,
  legalIndexSchema,
  licensesEditSchema,
  licensesPageSchema,
  siteConfigEditSchema,
  siteConfigSchema,
  siteDocumentEditSchema,
  type SiteDocumentEdit,
} from '../../contracts/site.js';
import { localDayOf } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';
import { SupportFaqModel } from '../account/models.js';
import { ChallengeDefinitionModel } from '../challenges/models.js';
import { SITE_DEFAULTS_WRITTEN_AT, SITE_DOCUMENT_DEFAULTS, SITE_PAGE_DEFAULTS } from './defaults/index.js';
import { SiteDocumentModel, SitePageModel } from './models.js';

/**
 * The public website's content (RULES P22): what is stored, what ships, and
 * what `GET /site/*` serves.
 *
 * A page is its saved row merged over the shipped copy — so a field added to
 * a page in a later build arrives with its shipped words instead of making
 * every saved copy invalid — and then held to the edited shape. A saved copy
 * that no longer fits (the shape tightened since it was saved) is logged and
 * the shipped copy is served instead: a stale edit must never take a page of
 * the public site down. The panel shows the same fault on the page's editor.
 */

// ─── The pages ─────────────────────────────────────────────────────────────

export const SITE_PAGE_KEYS = ['config', 'home', 'about', 'faq', 'contact', 'legal', 'deletion', 'licenses', 'invite'] as const;
export type SitePageKey = (typeof SITE_PAGE_KEYS)[number];

export interface SitePageSpec {
  label: string;
  /** Where it shows on the site; null for the frame every page shares. */
  path: string | null;
  caption: string;
  /** What the website must re-read after a save (its `/api/revalidate` tags). */
  tags: string[];
  schema: z.ZodType;
}

export const SITE_PAGES: Record<SitePageKey, SitePageSpec> = {
  config: {
    label: 'Header, footer & SEO',
    path: null,
    caption: 'The menu, the footer columns, the announcement bar, search defaults and the small words on every page.',
    tags: ['site:config'],
    schema: siteConfigEditSchema,
  },
  home: {
    label: 'Home',
    path: '/',
    caption: 'Hero, numbers, How it works, Features, Challenges, Fair play, Privacy, Questions, Download.',
    tags: ['site:home'],
    schema: homeEditSchema,
  },
  about: {
    label: 'About',
    path: '/about',
    caption: 'The story, the numbers, values, milestones, team.',
    tags: ['site:about'],
    schema: aboutEditSchema,
  },
  faq: {
    label: 'FAQ',
    path: '/faq',
    caption: 'The page around the questions. The questions themselves are the Help centre’s articles.',
    tags: ['site:faq'],
    schema: faqEditSchema,
  },
  contact: {
    label: 'Contact',
    path: '/contact',
    caption: 'The ways to reach us and the contact form’s words. The details themselves are on Contact & links.',
    tags: ['site:contact'],
    schema: contactEditSchema,
  },
  legal: {
    label: 'Legal hub',
    path: '/legal',
    caption: 'The page that lists every policy. The policies are under Documents.',
    tags: ['site:legal'],
    schema: legalIndexEditSchema,
  },
  deletion: {
    label: 'Delete your account',
    path: '/delete-account',
    caption: 'The page Google Play and Meta link to: how deletion works, what is erased and kept.',
    tags: ['site:deletion'],
    schema: deletionEditSchema,
  },
  licenses: {
    label: 'Open-source licences',
    path: '/licenses',
    caption: 'The open-source projects the app is built with.',
    tags: ['site:licenses'],
    schema: licensesEditSchema,
  },
  invite: {
    label: 'Invite link',
    path: '/r/CODE',
    caption: 'Where a member’s share link lands: the reward, the steps, the code.',
    tags: ['site:invite'],
    schema: inviteEditSchema,
  },
};

export function isSitePageKey(value: string): value is SitePageKey {
  return (SITE_PAGE_KEYS as readonly string[]).includes(value);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * `over` laid on `base`: objects merge key by key, everything else —
 * arrays, strings, null — is taken from `over` whole. So a list an editor
 * shortened stays short, and a section they emptied stays empty.
 */
export function mergeOver(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) merged[key] = mergeOver(base[key], value);
  return merged;
}

export interface LoadedContent<T = Record<string, unknown>> {
  content: T;
  revision: number;
  /** Nothing saved: this is the shipped copy. */
  isDefault: boolean;
  updatedAt: Date;
  updatedBy: string | null;
  /** The saved copy no longer fits the page's shape, so the shipped one is in use. */
  invalid: string | null;
}

export async function loadPage(key: SitePageKey): Promise<LoadedContent> {
  const spec = SITE_PAGES[key];
  const shipped = spec.schema.parse(SITE_PAGE_DEFAULTS[key]) as Record<string, unknown>;
  const row = await SitePageModel.findById(key).lean();
  if (!row) {
    return { content: shipped, revision: 0, isDefault: true, updatedAt: new Date(SITE_DEFAULTS_WRITTEN_AT), updatedBy: null, invalid: null };
  }
  const parsed = spec.schema.safeParse(mergeOver(SITE_PAGE_DEFAULTS[key], row.content));
  const updatedAt = (row as { updatedAt?: Date }).updatedAt ?? new Date();
  if (!parsed.success) {
    const invalid = z.prettifyError(parsed.error);
    logger.error({ page: key, revision: row.revision, invalid }, 'site.page_invalid');
    return { content: shipped, revision: row.revision, isDefault: false, updatedAt, updatedBy: row.updatedBy, invalid };
  }
  return {
    content: parsed.data as Record<string, unknown>,
    revision: row.revision,
    isDefault: false,
    updatedAt,
    updatedBy: row.updatedBy,
    invalid: null,
  };
}

// ─── The documents ─────────────────────────────────────────────────────────

/** The two every app store and payment provider asks for: never deleted, never hidden. */
export const CORE_DOCUMENTS = ['privacy', 'terms'] as const;

/**
 * Addresses a document cannot take: the site's own pages and files. A
 * document at `/about` would never be reached — the site's About page
 * answers first — so the panel refuses it rather than letting it vanish.
 */
export const RESERVED_SLUGS = new Set([
  'about', 'faq', 'contact', 'legal', 'licenses', 'delete-account', 'r', 'api', 'icon', 'apple-icon',
  'opengraph-image', 'sitemap', 'sitemap.xml', 'robots', 'robots.txt', 'manifest', 'manifest.webmanifest',
  'index', 'home', 'not-found', 'error', 'favicon.ico', 'static', 'public', 'assets', 'admin', 'login', 'app',
]);

export interface LoadedDocument extends LoadedContent<SiteDocumentEdit> {
  slug: string;
  /** One of the policies the site shipped with: it can be hidden, never deleted. */
  shipped: boolean;
  core: boolean;
  createdAt: Date | null;
}

function documentFrom(slug: string, row: { content: unknown; revision: number; updatedBy: string; createdAt?: Date; updatedAt?: Date } | null): LoadedDocument | null {
  const base = SITE_DOCUMENT_DEFAULTS[slug];
  const shipped = Boolean(base);
  const core = (CORE_DOCUMENTS as readonly string[]).includes(slug);
  if (!row) {
    if (!base) return null;
    return {
      slug,
      shipped,
      core,
      content: siteDocumentEditSchema.parse(base),
      revision: 0,
      isDefault: true,
      updatedAt: new Date(SITE_DEFAULTS_WRITTEN_AT),
      updatedBy: null,
      invalid: null,
      createdAt: null,
    };
  }
  const parsed = siteDocumentEditSchema.safeParse(base ? mergeOver(base, row.content) : row.content);
  const updatedAt = row.updatedAt ?? new Date();
  if (!parsed.success) {
    const invalid = z.prettifyError(parsed.error);
    logger.error({ document: slug, revision: row.revision, invalid }, 'site.document_invalid');
    if (!base) {
      // Nothing shipped to fall back on: the document stays off the site until it is fixed.
      return null;
    }
    return { slug, shipped, core, content: siteDocumentEditSchema.parse(base), revision: row.revision, isDefault: false, updatedAt, updatedBy: row.updatedBy, invalid, createdAt: row.createdAt ?? null };
  }
  return { slug, shipped, core, content: parsed.data, revision: row.revision, isDefault: false, updatedAt, updatedBy: row.updatedBy, invalid: null, createdAt: row.createdAt ?? null };
}

export async function loadDocument(slug: string): Promise<LoadedDocument | null> {
  const row = await SiteDocumentModel.findById(slug).lean();
  return documentFrom(slug, row as never);
}

/** Every document: the shipped five (saved or not) and everything created since, in hub order. */
export async function loadDocuments(): Promise<LoadedDocument[]> {
  const rows = await SiteDocumentModel.find().lean();
  const bySlug = new Map(rows.map(row => [row._id, row]));
  const slugs = new Set([...Object.keys(SITE_DOCUMENT_DEFAULTS), ...bySlug.keys()]);
  const docs = [...slugs].flatMap(slug => {
    const doc = documentFrom(slug, (bySlug.get(slug) ?? null) as never);
    return doc ? [doc] : [];
  });
  return docs.sort(
    (a, b) => a.content.listing.sort - b.content.listing.sort || a.content.title.localeCompare(b.content.title),
  );
}

// ─── Tokens ────────────────────────────────────────────────────────────────

const TOKEN = /\{\{([a-zA-Z]+)\}\}/g;

/**
 * The tokens the website fills itself from `GET /site/company` (RULES P21).
 * The server leaves them as written. Kept in step with
 * `vokve-frontend/src/lib/content/details.ts`.
 */
export const CONTACT_TOKENS = [
  'email', 'phone', 'phoneDisplay', 'whatsapp', 'whatsappDisplay', 'whatsappLink', 'hours', 'responseTime',
  'company', 'grievanceEmail', 'grievanceName', 'website',
] as const;

/** `+919876543210` → `+91 98765 43210`, as the website shows it. */
function formatPhone(e164: string): string {
  const india = /^\+91([6-9]\d{4})(\d{5})$/.exec(e164);
  return india ? `+91 ${india[1]} ${india[2]}` : e164;
}

const grouped = (n: number) => n.toLocaleString('en-IN');

/** 25 → "₹0.25", 4900 → "₹49", 99900 → "₹999". */
function rupees(paise: number): string {
  const value = paise / 100;
  return `₹${Number.isInteger(value) ? grouped(value) : value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Challenges that are switched on and not over — the ones the board shows. */
async function runningChallenges() {
  const today = localDayOf(new Date(), (await getConfig()).locale.timezone);
  const rows = await ChallengeDefinitionModel.find({ active: true }).lean();
  return rows.filter(row => !row.endsOn || row.endsOn >= today);
}

/**
 * Figures the server knows and fills in on the way out, so the words cannot
 * drift from what the app does: change ⚙ `account.deletionGraceDays` and
 * every "14 days" on the site changes with it.
 */
export async function configTokens(): Promise<Record<string, string>> {
  const config = await getConfig();
  const { coins, commerce } = config;
  const min = commerce.deliveryDaysMin;
  const max = commerce.deliveryDaysMax;
  return {
    graceDays: String(config.account.deletionGraceDays),
    coinValue: rupees(commerce.coinValuePaise),
    dailyCoinCap: grouped(coins.dailyCap),
    stepsCoinCap: grouped(coins.sourceCaps.steps),
    coinExpiryDays: String(coins.expiryDays),
    inviteReward: grouped(coins.referral.invitee),
    inviterReward: grouped(coins.referral.inviter),
    inviteWindowDays: String(coins.referral.applyWindowDays),
    deliveryDays: min === max ? String(min) : `${min}–${max}`,
    returnWindowDays: String(commerce.returnWindowDays),
    shippingFee: rupees(commerce.shippingFeePaise),
    freeShippingAbove: rupees(commerce.freeShippingAbovePaise),
    challengeCount: String((await runningChallenges()).length),
  };
}

/** Every token, what it stands for today, and who fills it — for the panel's editor. */
export async function tokenGuide() {
  const [figures, config] = await Promise.all([configTokens(), getConfig()]);
  const { support } = config;
  const contact: Record<(typeof CONTACT_TOKENS)[number], string | null> = {
    email: support.email,
    phone: support.phone,
    phoneDisplay: support.phone ? formatPhone(support.phone) : null,
    whatsapp: support.whatsapp,
    whatsappDisplay: support.whatsapp ? formatPhone(support.whatsapp) : null,
    whatsappLink: support.whatsapp ? `https://wa.me/${support.whatsapp.replace(/\D/g, '')}` : null,
    hours: support.hours,
    responseTime: support.responseTime,
    company: support.company,
    grievanceEmail: support.grievanceOfficer.email ?? support.email,
    grievanceName: support.grievanceOfficer.name,
    website: support.links.website,
  };
  return [
    ...Object.entries(figures).map(([name, value]) => ({ name, value, source: 'config' as const })),
    ...Object.entries(contact).map(([name, value]) => ({ name, value, source: 'contact' as const })),
  ];
}

/** Content with the server's own tokens filled; the website's are left for it. */
export function fillTokens<T>(value: T, tokens: Record<string, string>): T {
  if (typeof value === 'string') {
    return value.replace(TOKEN, (match, name: string) => (name in tokens ? tokens[name]! : match)) as T;
  }
  if (Array.isArray(value)) return value.map(item => fillTokens(item, tokens)) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillTokens(item, tokens)])) as T;
  }
  return value;
}

/** Every `{{token}}` the content uses that nobody fills, by where it is — refused on save. */
export function unknownTokens(value: unknown, known: ReadonlySet<string>, path: string[] = []): Record<string, string> {
  const found: Record<string, string> = {};
  if (typeof value === 'string') {
    for (const [, name] of value.matchAll(TOKEN)) {
      if (!known.has(name!)) {
        found[path.join('.') || '_'] = `{{${name}}} is not a token the site knows. Known: ${[...known].map(t => `{{${t}}}`).join(', ')}.`;
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => Object.assign(found, unknownTokens(item, known, [...path, String(index)])));
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) Object.assign(found, unknownTokens(item, known, [...path, key]));
  }
  return found;
}

export async function knownTokens(): Promise<Set<string>> {
  return new Set([...Object.keys(await configTokens()), ...CONTACT_TOKENS]);
}

// ─── What the website is served ────────────────────────────────────────────

const SOCIAL_KINDS = ['instagram', 'facebook', 'x', 'youtube', 'linkedin'] as const;
const SOCIAL_LABELS: Record<(typeof SOCIAL_KINDS)[number], string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
};

const CHALLENGE_ICONS: Record<string, string> = {
  steps: 'footprints',
  calories: 'flame',
  minutes: 'timer',
  days: 'target',
  workouts: 'dumbbell',
};
const CADENCE_ORDER = ['daily', 'weekly', 'monthly'];

async function activeFaqs() {
  const rows = await SupportFaqModel.find({ active: { $ne: false } }).sort({ sort: 1, _id: 1 }).lean();
  return rows.map(row => ({
    id: String(row._id),
    category: row.category,
    question: row.question,
    answer: row.answer,
    tags: row.tags ?? [],
  }));
}

async function servedConfig() {
  const { content } = await loadPage('config');
  const edit = content as z.infer<typeof siteConfigEditSchema>;
  const { support, app } = await getConfig();
  const { grievanceOfficerTitle, stores, ...frame } = edit;
  return siteConfigSchema.parse({
    ...frame,
    company: {
      legalName: support.company,
      email: support.email,
      phone: support.phone,
      whatsapp: support.whatsapp,
      hours: support.hours,
      responseTime: support.responseTime,
      address: support.address,
      grievanceOfficer: grievanceOfficerTitle
        ? { title: grievanceOfficerTitle, name: support.grievanceOfficer.name, email: support.grievanceOfficer.email ?? support.email }
        : null,
    },
    stores: {
      android: { ...stores.android, url: app.storeListed.android ? app.storeUrl.android : null },
      ios: { ...stores.ios, url: app.storeListed.ios ? app.storeUrl.ios : null },
    },
    social: SOCIAL_KINDS.flatMap(kind => {
      const url = support.social[kind];
      return url ? [{ kind, url, label: SOCIAL_LABELS[kind] }] : [];
    }),
  });
}

async function servedHome() {
  const { content } = await loadPage('home');
  const edit = content as z.infer<typeof homeEditSchema>;
  const { live, liveWords, items: manualItems, ...board } = edit.challenges;

  let items = manualItems;
  if (live) {
    const rows = await runningChallenges();
    const cadenceWord = { daily: liveWords.daily, weekly: liveWords.weekly, monthly: liveWords.monthly } as Record<string, string>;
    items = rows
      .sort(
        (a, b) =>
          CADENCE_ORDER.indexOf(a.cadence) - CADENCE_ORDER.indexOf(b.cadence) ||
          (a.sort ?? 0) - (b.sort ?? 0) ||
          String(a._id).localeCompare(String(b._id)),
      )
      .map(row => ({
        id: String(row._id),
        icon: CHALLENGE_ICONS[row.metric] ?? 'trophy',
        title: row.title,
        description: row.description ?? '',
        cadence: cadenceWord[row.cadence] ?? row.cadence,
        rewardLabel: liveWords.reward.replace('{coins}', grouped(row.rewardCoins)),
        badgeLabel: row.rewardsBadge ? liveWords.badge : null,
      }));
  }

  const faqs = await activeFaqs();
  const byId = new Map(faqs.map(faq => [faq.id, faq]));
  const { itemIds, ...faqHead } = edit.faq;

  return homePageSchema.parse({
    ...edit,
    challenges: { ...board, items },
    faq: { ...faqHead, items: itemIds.flatMap(id => byId.get(id) ?? []) },
  });
}

async function servedFaqPage() {
  const { content } = await loadPage('faq');
  return faqPageSchema.parse({ ...content, items: await activeFaqs() });
}

async function servedDeletion() {
  const { content } = await loadPage('deletion');
  return deletionGuideSchema.parse({ ...content, graceDays: (await getConfig()).account.deletionGraceDays });
}

const servedDocument = (doc: LoadedDocument) => {
  const { published: _published, listing: _listing, ...body } = doc.content;
  return legalDocumentSchema.parse({ ...body, slug: doc.slug });
};

/** When a page linked from the legal hub last changed, for its "updated" line. */
async function updatedAtOf(href: string, fallback: Date): Promise<string> {
  const key = Object.entries(SITE_PAGES).find(([, spec]) => spec.path === href)?.[0] as SitePageKey | undefined;
  if (!key) return fallback.toISOString();
  const page = await loadPage(key);
  const own = (page.content as { updatedAt?: unknown }).updatedAt;
  return typeof own === 'string' ? own : page.updatedAt.toISOString();
}

async function servedLegalIndex() {
  const [page, docs] = await Promise.all([loadPage('legal'), loadDocuments()]);
  const edit = page.content as z.infer<typeof legalIndexEditSchema>;
  const listed = docs
    .filter(doc => doc.content.published && doc.content.listing.show)
    .map(doc => ({
      slug: doc.slug,
      title: doc.content.title,
      summary: doc.content.listing.summary.trim() || doc.content.summary,
      href: `/${doc.slug}`,
      icon: doc.content.listing.icon,
      updatedAt: doc.content.updatedAt,
    }));
  const extra = await Promise.all(
    edit.extraLinks.map(async link => ({
      slug: link.href.replace(/^\/+/, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'link',
      title: link.title,
      summary: link.summary,
      href: link.href,
      icon: link.icon,
      updatedAt: await updatedAtOf(link.href, page.updatedAt),
    })),
  );
  return legalIndexSchema.parse({ seo: edit.seo, hero: edit.hero, documents: [...listed, ...extra] });
}

/** The public reads, by what the website asks for. Each answer has its tokens filled. */
export async function servePage(key: SitePageKey): Promise<unknown> {
  const tokens = await configTokens();
  switch (key) {
    case 'config':
      return fillTokens(await servedConfig(), tokens);
    case 'home':
      return fillTokens(await servedHome(), tokens);
    case 'faq':
      return fillTokens(await servedFaqPage(), tokens);
    case 'deletion':
      return fillTokens(await servedDeletion(), tokens);
    case 'legal':
      return fillTokens(await servedLegalIndex(), tokens);
    case 'about':
      return fillTokens(aboutPageSchema.parse((await loadPage('about')).content), tokens);
    case 'contact':
      return fillTokens(contactPageSchema.parse((await loadPage('contact')).content), tokens);
    case 'licenses':
      return fillTokens(licensesPageSchema.parse((await loadPage('licenses')).content), tokens);
    case 'invite':
      return fillTokens(invitePageSchema.parse((await loadPage('invite')).content), tokens);
  }
}

/** A published document as the website reads it; null for one that does not exist or is hidden. */
export async function serveDocument(slug: string): Promise<unknown | null> {
  const doc = await loadDocument(slug);
  if (!doc || !doc.content.published) return null;
  return fillTokens(servedDocument(doc), await configTokens());
}
