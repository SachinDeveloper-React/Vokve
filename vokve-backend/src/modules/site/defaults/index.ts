import { DEFAULT_ABOUT } from './about.js';
import { DEFAULT_SITE_CONFIG } from './config.js';
import { DEFAULT_CONTACT } from './contact.js';
import { DEFAULT_DELETION } from './deletion.js';
import { refundPolicy, shippingPolicy } from './documents/commerce.js';
import { privacyPolicy } from './documents/privacy.js';
import { rewardsPolicy } from './documents/rewards.js';
import { termsAndConditions } from './documents/terms.js';
import { DEFAULT_FAQ_PAGE } from './faq.js';
import { DEFAULT_HOME } from './home.js';
import { DEFAULT_INVITE } from './invite.js';
import { DEFAULT_LEGAL_INDEX } from './legal.js';
import { DEFAULT_LICENSES } from './licenses.js';
import type { SiteDocumentInput } from './types.js';

/**
 * What the website says before anybody has edited it (RULES P22) — the copy
 * the site was built with, moved here from its mock files so the server is
 * the one source. A page nobody has saved is served from these; a saved one
 * from `site_pages`. "Back to the default" on the panel deletes the saved row.
 */
export const SITE_PAGE_DEFAULTS = {
  config: DEFAULT_SITE_CONFIG,
  home: DEFAULT_HOME,
  about: DEFAULT_ABOUT,
  faq: DEFAULT_FAQ_PAGE,
  contact: DEFAULT_CONTACT,
  legal: DEFAULT_LEGAL_INDEX,
  deletion: DEFAULT_DELETION,
  licenses: DEFAULT_LICENSES,
  invite: DEFAULT_INVITE,
} as const;

/** The policies the site shipped with, by slug. Others are created on the panel. */
export const SITE_DOCUMENT_DEFAULTS: Record<string, SiteDocumentInput> = {
  privacy: privacyPolicy,
  terms: termsAndConditions,
  'rewards-policy': rewardsPolicy,
  'refund-policy': refundPolicy,
  'shipping-policy': shippingPolicy,
};

/** When the shipped copy was written — the "last updated" of a page nobody has saved. */
export const SITE_DEFAULTS_WRITTEN_AT = '2026-11-21T00:00:00.000Z';
