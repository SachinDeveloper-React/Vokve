/**
 * The public website's content (RULES P22).
 *
 * Two families of shapes live here:
 *
 *   - **Served** (`site*Schema`, `*PageSchema`) — exactly what the website
 *     parses: a copy of `vokve-frontend/src/lib/content/schemas.ts`, which is
 *     the contract. Every public `GET /site/*` answer is held to one of these
 *     before it leaves, so a mistake here is a 500 on our side rather than a
 *     broken page on theirs.
 *   - **Edited** (`*EditSchema`) — what the panel writes and what is stored.
 *     Mostly the served shape itself; where a value is the server's to know
 *     (the contact details, the deletion grace days, the help-centre
 *     articles, the challenge board, the list of policies) the edited shape
 *     leaves it out and the server fills it in on the way out, so nobody types
 *     a second copy of a number that already lives somewhere.
 *
 * `.meta()` notes are for the panel's editor and change nothing about what
 * parses: `widget` picks a special input (`icon`, `date`, `numbers`,
 * `faq-ids`), `multiline` asks for a text area, `title`/`description` label
 * the box. The editor is drawn from `z.toJSONSchema()` of the edited shape,
 * so a field added here appears on the panel with no panel change.
 */
import { z } from 'zod';

// ─── Shared pieces ──────────────────────────────────────────────────────────

/** The glyphs the website can draw (`vokve-frontend/src/components/ui/Icon.tsx`). Others draw a plain circle. */
export const SITE_ICONS = [
  'activity', 'badge-check', 'bell', 'building-2', 'calendar-days', 'circle-help', 'clock', 'code', 'coins',
  'compass', 'database', 'download', 'droplets', 'dumbbell', 'eye', 'file-text', 'fingerprint', 'flame',
  'footprints', 'gift', 'globe', 'handshake', 'heart', 'heart-pulse', 'hourglass', 'key-round', 'leaf',
  'life-buoy', 'lock', 'mail', 'map-pin', 'medal', 'message-circle', 'package', 'phone', 'receipt', 'rocket',
  'rotate-ccw', 'route', 'salad', 'scale', 'scan-face', 'shield-check', 'shopping-bag', 'sliders-horizontal',
  'smartphone', 'sparkles', 'star', 'target', 'timer', 'trash-2', 'trophy', 'truck', 'undo-2', 'users',
  'user-x', 'wallet', 'zap',
] as const;

/** An internal path (`/privacy`, `/#features`) or an absolute/mailto/tel URL. Tokens are allowed: `mailto:{{email}}`. */
const href = z
  .string()
  .trim()
  .min(1)
  .refine(
    v => v.startsWith('/') || v.startsWith('#') || /^(https?:|mailto:|tel:)/.test(v) || /^\{\{[a-zA-Z]+\}\}$/.test(v),
    'Must be a path (/about), an #anchor, or an http(s), mailto: or tel: link',
  )
  .meta({ widget: 'href' });

const isoDate = z
  .string()
  .refine(v => !Number.isNaN(Date.parse(v)), 'Must be a date (2026-11-21)')
  .meta({ widget: 'date' });

/** Lucide icon name in kebab-case; unknown names render a fallback glyph. */
const iconName = z.string().min(1).meta({ widget: 'icon' });

const text = z.string().meta({ multiline: true });

export const siteToneSchema = z
  .enum(['brand', 'orange', 'blue', 'violet', 'gold', 'green', 'cyan', 'pink'])
  .catch('brand');

export const siteLinkSchema = z.object({ label: z.string().min(1), href });

const seoSchema = z
  .object({
    title: z.string().min(1).meta({ description: 'The browser tab and the search result headline.' }),
    description: z.string().min(1).meta({ multiline: true }).meta({ description: 'The line under the headline in search results and link previews.' }),
  })
  .meta({ title: 'Search & sharing' });

const sectionHead = z.object({
  eyebrow: z.string().nullable().meta({ description: 'A short section name above the title ("How it works"). Empty for none.' }),
  title: z.string().min(1),
  subtitle: text.nullable(),
});

export const siteFaqItemSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  question: z.string().min(1),
  answer: text,
  tags: z.array(z.string()).default([]),
});

// ─── /site/config — every page's frame ─────────────────────────────────────

const storeWords = z.object({
  label: z.string().min(1).meta({ description: '"Google Play", "App Store".' }),
  caption: z.string().min(1).meta({ description: 'The small line above it: "Get it on".' }),
  note: z.string().nullable().meta({ description: 'Shown instead of a link while the listing is not live ("Coming soon").' }),
});

const servedStore = storeWords.extend({ url: z.url().nullable() });

const labelsSchema = z
  .object({
    skipToContent: z.string(),
    menu: z.string(),
    close: z.string(),
    themeToggle: z.string(),
    onThisPage: z.string(),
    lastUpdated: z.string(),
    effectiveFrom: z.string(),
    version: z.string(),
    shortVersion: z.string(),
    searchPlaceholder: z.string(),
    allCategories: z.string(),
    noResults: z.string(),
    copy: z.string(),
    copied: z.string(),
    readMore: z.string(),
    notFoundTitle: z.string(),
    notFoundBody: z.string(),
    backHome: z.string(),
    questionsTitle: z.string(),
    questionsBody: z.string(),
  })
  .meta({ title: 'Small words', description: 'The words of the header, footer and buttons that every page shares.' });

const siteFrame = z.object({
  brand: z.object({
    name: z.string().min(1),
    tagline: z.string().min(1),
    description: z.string().min(1).meta({ multiline: true }),
  }),
  seo: z.object({
    siteUrl: z.url(),
    titleTemplate: z.string().includes('%s').meta({ description: '%s is replaced by each page’s own title.' }),
    defaultTitle: z.string().min(1),
    description: z.string().min(1).meta({ multiline: true }),
    keywords: z.array(z.string()),
  }),
  announcement: z
    .object({ badge: z.string().nullable(), text: z.string().min(1), link: siteLinkSchema.nullable() })
    .nullable()
    .meta({ description: 'The thin bar above the header. Empty hides it.' }),
  nav: z.array(siteLinkSchema).min(1).meta({ title: 'Header menu' }),
  headerCta: siteLinkSchema.meta({ title: 'Header button' }),
  footer: z.object({
    blurb: text,
    columns: z.array(z.object({ title: z.string(), links: z.array(siteLinkSchema) })),
    copyright: z.string(),
    disclaimer: text.nullable(),
  }),
  labels: labelsSchema,
});

export const siteConfigEditSchema = siteFrame.extend({
  /** The title over the Grievance Officer's box; the officer themselves is on the Contact & links page. */
  grievanceOfficerTitle: z
    .string()
    .nullable()
    .meta({ description: 'The heading over the Grievance Officer’s details. The name and email are on the Contact & links page. Empty hides the box.' }),
  stores: z
    .object({ android: storeWords, ios: storeWords })
    .meta({ title: 'Store buttons', description: 'Their words. The links, and whether each listing is live, are on the Contact & links page.' }),
});
export type SiteConfigEdit = z.infer<typeof siteConfigEditSchema>;

export const siteConfigSchema = siteFrame.extend({
  company: z.object({
    legalName: z.string().min(1),
    email: z.email(),
    phone: z.string().nullable(),
    whatsapp: z.string().nullable(),
    hours: z.string().nullable(),
    responseTime: z.string().nullable(),
    address: z.array(z.string()),
    grievanceOfficer: z.object({ title: z.string(), name: z.string().nullable(), email: z.email() }).nullable(),
  }),
  stores: z.object({ android: servedStore, ios: servedStore }),
  social: z.array(
    z.object({
      kind: z.enum(['instagram', 'x', 'youtube', 'linkedin', 'facebook']),
      url: z.url(),
      label: z.string(),
    }),
  ),
});

// ─── /site/pages/home ───────────────────────────────────────────────────────

const statSchema = z.object({ value: z.string().min(1), label: z.string().min(1) });

const dayStatusSchema = z.object({
  text: z.string().min(1).meta({ description: 'Written the way the wallet writes a day: "Pending · +7.98 coins".' }),
  state: z.enum(['neutral', 'pending', 'paid']).catch('neutral'),
});

const daySampleSchema = z.object({
  title: z.string().min(1),
  date: z.string().min(1),
  hours: z
    .array(z.number().int().nonnegative())
    .length(24)
    .meta({ widget: 'numbers', description: 'Steps in each hour, midnight to 11 pm — 24 numbers.' }),
  walk: z
    .object({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24), label: z.string() })
    .refine(w => w.to > w.from, 'The walk must end after it starts')
    .meta({ description: 'The hours drawn in red: from (inclusive) to (exclusive).' }),
  stepsLabel: z.string(),
  status: dayStatusSchema,
});

const heroSchema = z.object({
  eyebrow: z.string().nullable(),
  title: z.string().min(1),
  highlight: z.string().nullable().meta({ description: 'A part of the title to set in red. Empty for none.' }),
  subtitle: text,
  primaryCta: siteLinkSchema.meta({ title: 'Main button' }),
  secondaryCta: siteLinkSchema.nullable().meta({ title: 'Second button' }),
  trust: z.array(z.string()).meta({ description: 'Short promises, shown as one quiet line under the numbers.' }),
  scene: z
    .object({
      dayLabel: z.string(),
      verifiedLabel: z.string(),
      steps: z.number().int().nonnegative(),
      goal: z.number().int().positive(),
      stepsLabel: z.string(),
      goalLabel: z.string(),
      metrics: z.array(z.object({ icon: iconName, value: z.string(), label: z.string() })).max(3),
      streak: z.object({ value: z.string(), label: z.string() }),
      challenge: z.object({ title: z.string(), progress: z.number().min(0).max(1), reward: z.string() }),
      rank: z.object({ value: z.string(), label: z.string() }),
      coin: z.object({ value: z.string(), label: z.string() }),
    })
    .meta({ title: 'The “Today” card', description: 'The example day drawn beside the headline.' }),
});

const howItWorksSchema = sectionHead
  .extend({
    steps: z.array(
      z.object({
        icon: iconName,
        title: z.string(),
        body: text,
        status: dayStatusSchema.nullable().default(null),
      }),
    ),
  })
  .meta({ title: 'How it works' });

const featuresSchema = sectionHead
  .extend({
    items: z
      .array(
        z.object({
          icon: iconName,
          title: z.string(),
          body: text,
          tone: siteToneSchema.optional(),
          span: z.enum(['wide', 'regular']).catch('regular').optional(),
        }),
      )
      .meta({ description: 'The first one leads, drawn large; the rest follow as a list.' }),
  })
  .meta({ title: 'Features' });

const challengeItemSchema = z.object({
  id: z.string(),
  icon: iconName.default('trophy'),
  title: z.string(),
  description: z.string(),
  cadence: z.string(),
  rewardLabel: z.string(),
  badgeLabel: z.string().nullable(),
});

const challengesBase = sectionHead.extend({ items: z.array(challengeItemSchema), note: text.nullable() });

const fairPlaySchema = sectionHead
  .extend({
    layers: z.array(z.object({ icon: iconName, title: z.string(), body: text })),
    note: text.nullable(),
    sample: daySampleSchema.nullable().default(null).meta({ title: 'The hour-by-hour chart', description: 'Empty hides the chart.' }),
  })
  .meta({ title: 'Fair play' });

const privacyPointsSchema = sectionHead
  .extend({
    points: z.array(
      z.object({
        icon: iconName,
        tone: siteToneSchema.optional(),
        title: z.string(),
        body: text,
        link: siteLinkSchema.nullable(),
      }),
    ),
  })
  .meta({ title: 'Privacy' });

const downloadSchema = z
  .object({ eyebrow: z.string().nullable(), title: z.string(), subtitle: text, note: text.nullable() })
  .meta({ title: 'Download' });

export const homePageSchema = z.object({
  seo: seoSchema,
  hero: heroSchema,
  stats: z.array(statSchema),
  howItWorks: howItWorksSchema,
  features: featuresSchema,
  challenges: challengesBase,
  fairPlay: fairPlaySchema,
  privacy: privacyPointsSchema,
  faq: sectionHead.extend({ items: z.array(siteFaqItemSchema), cta: siteLinkSchema }),
  download: downloadSchema,
});

export const homeEditSchema = homePageSchema.extend({
  challenges: challengesBase
    .extend({
      live: z
        .boolean()
        .default(true)
        .meta({ title: 'Show the live challenges', description: 'On: the board lists every running challenge from the Challenges page, in these words. Off: it lists the items below.' }),
      liveWords: z
        .object({
          daily: z.string().min(1),
          weekly: z.string().min(1),
          monthly: z.string().min(1),
          reward: z.string().includes('{coins}').meta({ description: '{coins} is replaced by the reward: "{coins} coins".' }),
          badge: z.string().nullable().meta({ description: 'Shown beside a reward that also unlocks a badge. Empty for nothing.' }),
        })
        .default({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', reward: '{coins} coins', badge: '+ badge' })
        .meta({ title: 'Words for the live board' }),
    })
    .meta({ title: 'Challenges' }),
  faq: sectionHead
    .extend({
      itemIds: z
        .array(z.string().min(1))
        .meta({ widget: 'faq-ids', title: 'Questions', description: 'Picked from the Help centre, in this order. Hidden articles are left out.' }),
      cta: siteLinkSchema,
    })
    .meta({ title: 'Questions' }),
});
export type HomeEdit = z.infer<typeof homeEditSchema>;

// ─── /site/pages/about ──────────────────────────────────────────────────────

export const aboutPageSchema = z.object({
  seo: seoSchema,
  hero: sectionHead,
  story: z.object({
    eyebrow: z.string(),
    title: z.string(),
    paragraphs: z.array(text).min(1),
    quote: z.object({ text, attribution: z.string() }).nullable(),
  }),
  numbers: z.array(statSchema),
  values: sectionHead.extend({
    items: z.array(z.object({ icon: iconName, tone: siteToneSchema, title: z.string(), body: text })),
  }),
  milestones: sectionHead.extend({
    items: z.array(z.object({ when: z.string(), title: z.string(), body: text })),
  }),
  team: sectionHead
    .extend({ members: z.array(z.object({ name: z.string(), role: z.string(), photoUrl: z.url().nullable() })) })
    .nullable()
    .meta({ description: 'Empty hides the team section.' }),
  cta: z.object({ title: z.string(), body: text, primary: siteLinkSchema, secondary: siteLinkSchema.nullable() }),
});
export const aboutEditSchema = aboutPageSchema;

// ─── Legal documents ────────────────────────────────────────────────────────

const paragraphBlock = z.object({ type: z.literal('paragraph'), text }).meta({ title: 'Paragraph' });
const listBlock = z
  .object({ type: z.literal('list'), style: z.enum(['bullet', 'number']).catch('bullet'), items: z.array(text).min(1) })
  .meta({ title: 'List' });
const calloutBlock = z
  .object({
    type: z.literal('callout'),
    tone: z.enum(['info', 'warning', 'success']).catch('info'),
    title: z.string().nullable(),
    text,
  })
  .meta({ title: 'Callout' });
const tableBlock = z
  .object({ type: z.literal('table'), columns: z.array(z.string()).min(1), rows: z.array(z.array(z.string())) })
  .meta({ title: 'Table' });
const definitionsBlock = z
  .object({ type: z.literal('definitions'), items: z.array(z.object({ term: z.string(), description: text })) })
  .meta({ title: 'Definitions' });

export const siteLegalBlockSchema = z.discriminatedUnion('type', [
  paragraphBlock,
  listBlock,
  calloutBlock,
  tableBlock,
  definitionsBlock,
]);

const sectionId = z
  .string()
  .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens (it is the #anchor)')
  .meta({ title: 'Anchor', description: 'The #part of a link to this section (/privacy#your-choices). Keep it when only the words change, so old links still land.' });

const documentBody = z.object({
  title: z.string().min(1),
  eyebrow: z.string(),
  summary: text,
  version: z.string(),
  effectiveAt: isoDate,
  updatedAt: isoDate.meta({ description: 'The “Last updated” date readers see. Move it when the meaning changes, not for a typo.' }),
  highlights: z.array(text).meta({ title: 'The short version', description: 'The points shown in a box at the top.' }),
  sections: z
    .array(z.object({ id: sectionId, title: z.string().min(1), blocks: z.array(siteLegalBlockSchema) }))
    .min(1),
});

export const siteDocumentSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{1,60}$/, 'A web address part: lowercase letters, numbers and hyphens, like cookie-policy');

/** What the panel edits for a policy: its text, and how it is listed. */
export const siteDocumentEditSchema = documentBody.extend({
  published: z
    .boolean()
    .default(true)
    .meta({ title: 'Published', description: 'Off: the page answers “not found” and drops out of the legal hub and the sitemap.' }),
  listing: z
    .object({
      show: z.boolean().default(true).meta({ title: 'List on the legal hub' }),
      summary: z.string().meta({ description: 'The one line under its name on /legal. Empty uses the summary.' }),
      icon: iconName,
      sort: z.number().int().min(-1000).max(1000).default(0).meta({ description: 'Lower comes first.' }),
    })
    .meta({ title: 'On the legal hub' }),
});
export type SiteDocumentEdit = z.infer<typeof siteDocumentEditSchema>;

export const legalDocumentSchema = documentBody.extend({ slug: siteDocumentSlugSchema });

const legalLinkSchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  href,
  icon: iconName,
  updatedAt: isoDate,
});

export const legalIndexSchema = z.object({ seo: seoSchema, hero: sectionHead, documents: z.array(legalLinkSchema) });

export const legalIndexEditSchema = z.object({
  seo: seoSchema,
  hero: sectionHead,
  extraLinks: z
    .array(z.object({ title: z.string().min(1), summary: z.string(), href, icon: iconName }))
    .meta({ title: 'More links', description: 'Listed after the policies: pages that are not policies but belong here (account deletion, licences).' }),
});

// ─── /site/account-deletion ─────────────────────────────────────────────────

export const deletionGuideSchema = z.object({
  seo: seoSchema,
  hero: sectionHead,
  updatedAt: isoDate,
  graceDays: z.number().int().positive(),
  timeline: z.array(z.object({ label: z.string(), title: z.string(), body: text })),
  inApp: z.object({
    title: z.string(),
    subtitle: z.string().nullable(),
    path: z.array(z.string()).min(1).meta({ description: 'The taps, in order: Account › Privacy › Delete my account.' }),
    steps: z.array(z.object({ title: z.string(), body: text })).min(1),
  }),
  confirmation: z.object({
    title: z.string(),
    items: z.array(z.object({ icon: iconName, title: z.string(), body: text })),
  }),
  erased: z.object({ title: z.string(), items: z.array(z.string()) }),
  retained: z.object({ title: z.string(), items: z.array(z.object({ item: z.string(), reason: text })) }),
  noAccess: z.object({
    title: z.string(),
    body: text,
    email: z.string().min(1).meta({ description: 'Usually {{email}}, the support address from the Contact & links page.' }),
    subject: z.string(),
    bodyTemplate: text,
    buttonLabel: z.string(),
    note: z.string().nullable(),
  }),
  export: z.object({ title: z.string(), body: text, path: z.array(z.string()) }),
  faqTitle: z.string(),
  faqs: z.array(siteFaqItemSchema),
});

/** Grace days are ⚙ `account.deletionGraceDays`: write {{graceDays}} in the words. */
export const deletionEditSchema = deletionGuideSchema.omit({ graceDays: true });

// ─── /site/faqs ─────────────────────────────────────────────────────────────

const faqCategoriesSchema = z
  .array(z.object({ id: z.string(), title: z.string(), icon: iconName }))
  .meta({ description: 'The topic buttons, by the Help centre’s category ids: account, coins, orders, tracking, payments, privacy, other.' });

export const faqPageSchema = z.object({
  seo: seoSchema,
  hero: sectionHead,
  categories: faqCategoriesSchema,
  items: z.array(siteFaqItemSchema),
  contact: z.object({ title: z.string(), body: text, link: siteLinkSchema }),
});

/** The questions themselves are the Help centre's articles. */
export const faqEditSchema = faqPageSchema.omit({ items: true });

// ─── /site/pages/contact ────────────────────────────────────────────────────

export const contactFormCopySchema = z
  .object({
    title: z.string().min(1),
    subtitle: text.nullable(),
    nameLabel: z.string().min(1),
    emailLabel: z.string().min(1),
    phoneLabel: z.string().nullable().meta({ description: 'Empty leaves the phone box out.' }),
    topicLabel: z.string().min(1),
    topics: z.array(z.string().min(1).max(60)).min(1).max(12).meta({ description: 'What a visitor can pick it is about.' }),
    messageLabel: z.string().min(1),
    messagePlaceholder: z.string().nullable(),
    consent: text.nullable().meta({ description: 'The small print under the button.' }),
    submitLabel: z.string().min(1),
    sendingLabel: z.string().min(1),
    successTitle: z.string().min(1),
    successBody: text,
    errorBody: text.meta({ description: 'When the message could not be sent.' }),
    rateLimitedBody: text.meta({ description: 'When the same visitor has sent too many today.' }),
  })
  .nullable()
  .meta({ title: 'Contact form', description: 'Messages land on the panel’s Enquiries page. Empty hides the form.' });

export const contactPageSchema = z.object({
  seo: seoSchema,
  hero: sectionHead,
  channels: z
    .array(
      z.object({
        icon: iconName,
        tone: siteToneSchema,
        title: z.string(),
        value: z.string(),
        href: href.nullable(),
        note: z.string().nullable(),
      }),
    )
    .meta({ description: 'Write {{email}}, {{phone}}, {{whatsappLink}}… rather than the details themselves. A channel needing a detail that is not set is left out.' }),
  inApp: z.object({ title: z.string(), body: text, path: z.array(z.string()) }),
  companyTitle: z.string(),
  grievanceNote: text.nullable(),
  form: contactFormCopySchema.default(null),
});
export const contactEditSchema = contactPageSchema;

// ─── /site/pages/licenses and /site/pages/invite ───────────────────────────

export const licensesPageSchema = z.object({
  seo: seoSchema,
  hero: sectionHead,
  intro: text,
  packages: z.array(z.object({ name: z.string(), version: z.string(), license: z.string(), url: z.url().nullable() })),
});
export const licensesEditSchema = licensesPageSchema;

export const invitePageSchema = z.object({
  seo: seoSchema,
  hero: sectionHead,
  reward: z.object({ value: z.string(), label: z.string() }),
  codeLabel: z.string(),
  steps: z.array(z.object({ title: z.string(), body: text })),
  invalid: z.object({ title: z.string(), body: text }),
  codePattern: z
    .string()
    .refine(v => {
      try {
        new RegExp(v);
        return true;
      } catch {
        return false;
      }
    }, 'Must be a valid regular expression')
    .meta({ description: 'The shape an invite code must have — the server’s own alphabet and length.' }),
});
export const inviteEditSchema = invitePageSchema;

// ─── The contact form ───────────────────────────────────────────────────────

/** `POST /site/contact` — what the website's form sends. */
export const siteEnquiryBodySchema = z
  .object({
    name: z.string().trim().min(1, 'Please tell us your name').max(80),
    email: z.email('That email address does not look right').trim().max(160),
    phone: z
      .string()
      .trim()
      .max(20)
      .regex(/^[+\d][\d\s-]{5,19}$/, 'That phone number does not look right')
      .nullable()
      .optional(),
    topic: z.string().trim().max(60).nullable().optional(),
    message: z.string().trim().min(10, 'Please write a little more').max(4000, 'Please keep it under 4,000 characters'),
    /** The page it was sent from. */
    page: z.string().trim().max(200).nullable().optional(),
    /** A box people cannot see: anything in it is a bot. */
    website: z.string().max(500).optional(),
  })
  .strict();
export type SiteEnquiryBody = z.infer<typeof siteEnquiryBodySchema>;

export const SITE_ENQUIRY_STATUSES = ['new', 'open', 'replied', 'closed', 'spam'] as const;
export type SiteEnquiryStatus = (typeof SITE_ENQUIRY_STATUSES)[number];
