import type { z } from 'zod';
import type { legalIndexEditSchema } from '../../../contracts/site.js';

/**
 * The legal hub's frame as it ships (RULES P22). The policies it lists are
 * the published documents themselves, in their own order; `extraLinks`
 * follow them.
 */
export const DEFAULT_LEGAL_INDEX: z.input<typeof legalIndexEditSchema> = {
  seo: {
    title: 'Legal',
    description: 'Every VOKVE policy in one place: privacy, terms, coins, refunds and shipping.',
  },
  hero: {
    eyebrow: 'Legal',
    title: 'The fine print, in plain words',
    subtitle: 'Everything that governs your use of VOKVE. Each document starts with a short version.',
  },
  extraLinks: [
    {
      title: 'Account deletion',
      summary: 'How to delete your account and what happens to your data.',
      href: '/delete-account',
      icon: 'trash-2',
    },
    {
      title: 'Open-source licences',
      summary: 'The open-source software VOKVE is built with.',
      href: '/licenses',
      icon: 'code',
    },
  ],
};
