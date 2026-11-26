import type { z } from 'zod';
import type { inviteEditSchema } from '../../../contracts/site.js';

/**
 * The share-link landing as it ships (RULES P22), behind ⚙
 * `support.inviteUrlBase` + `/{code}`. The rewards are ⚙ `coins.referral`
 * (`{{inviteReward}}`, `{{inviterReward}}`, `{{inviteWindowDays}}`); the
 * pattern is the server's code alphabet (RULES F1: no O, 0, I or 1) and
 * length (7).
 */
export const DEFAULT_INVITE: z.input<typeof inviteEditSchema> = {
  seo: {
    title: 'You’re invited to VOKVE',
    description: 'A friend invited you to VOKVE — the app that pays you coins for walking. Join with their code and you both get coins.',
  },
  hero: {
    eyebrow: 'You’re invited',
    title: 'A friend wants you walking with them',
    subtitle: 'Join VOKVE with their invite code and you both get coins once you get going.',
  },
  reward: { value: '{{inviteReward}} coins', label: 'for you, and {{inviterReward}} for your friend' },
  codeLabel: 'Your invite code',
  steps: [
    { title: 'Download VOKVE', body: 'From Google Play or the App Store.' },
    { title: 'Sign up', body: 'Create your account and verify your email and phone.' },
    { title: 'Enter the code', body: 'On the Refer & Earn screen, within {{inviteWindowDays}} days of joining.' },
    { title: 'Get moving', body: 'The coins land once your first active day checks out.' },
  ],
  invalid: {
    title: 'This invite link looks incomplete',
    body: 'Ask your friend to send their code again — it is 7 letters and numbers. You can still download VOKVE and add the code later.',
  },
  codePattern: '^[A-HJ-NP-Z2-9]{7}$',
};
