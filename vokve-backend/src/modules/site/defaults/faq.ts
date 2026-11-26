import type { z } from 'zod';
import type { faqEditSchema } from '../../../contracts/site.js';

/**
 * The FAQ page's frame as it ships (RULES P22). The questions are not here:
 * they are the Help centre's own articles (`support_faqs`, active ones in
 * shelf order), so the app and the website answer with the same words.
 */
export const DEFAULT_FAQ_PAGE: z.input<typeof faqEditSchema> = {
  seo: {
    title: 'Help & FAQ',
    description:
      'Answers about earning and spending coins, step tracking, orders, your account and your privacy on VOKVE.',
  },
  hero: {
    eyebrow: 'Help centre',
    title: 'Questions, answered',
    subtitle:
      'The same answers our support team gives inside the app. Search, or browse by topic.',
  },
  categories: [
    { id: 'coins', title: 'Coins & rewards', icon: 'coins' },
    { id: 'tracking', title: 'Step tracking', icon: 'footprints' },
    { id: 'orders', title: 'Orders & shipping', icon: 'package' },
    { id: 'payments', title: 'Payments', icon: 'wallet' },
    { id: 'account', title: 'Your account', icon: 'key-round' },
    { id: 'privacy', title: 'Privacy & safety', icon: 'shield-check' },
    { id: 'other', title: 'Everything else', icon: 'life-buoy' },
  ],
  contact: {
    title: 'Still stuck?',
    body: 'Open a ticket from Help & Support in the app, or write to us — a person will answer.',
    link: { label: 'Contact support', href: '/contact' },
  },
};
