import type { z } from 'zod';
import type { deletionEditSchema } from '../../../contracts/site.js';

/**
 * The account-deletion guide as it ships (RULES P22). Written from the real
 * flow (RULES P5, `account/service.scheduleDeletion` / `purgeAccount`, the
 * app's PrivacyScreen): scheduled ⚙ `account.deletionGraceDays` ahead —
 * `{{graceDays}}` in the words, filled by the server — re-proved with the
 * account's own way in, cancellable until then.
 *
 * This is the URL given to Google Play ("Delete account URL") and Meta
 * ("Data deletion instructions URL").
 */
export const DEFAULT_DELETION: z.input<typeof deletionEditSchema> = {
  seo: {
    title: 'Delete your account',
    description:
      'How to delete your VOKVE account and data — from the app in a minute, or by email if you no longer have the app. Deletion has a {{graceDays}}-day undo.',
  },
  hero: {
    eyebrow: 'Account & data',
    title: 'Delete your VOKVE account',
    subtitle:
      'You can do it from the app in under a minute. We schedule it {{graceDays}} days ahead so you can change your mind — then your personal data is erased for good.',
  },
  updatedAt: '2026-11-21',
  timeline: [
    {
      label: 'Day 0',
      title: 'You ask',
      body: 'Confirm it is you, tell us why if you like, and the deletion is scheduled.',
    },
    {
      label: 'Days 1–{{graceDays}}',
      title: 'You can change your mind',
      body: 'Your account keeps working. Cancel from the same screen and nothing is lost.',
    },
    {
      label: 'Day {{graceDays}}',
      title: 'It is erased',
      body: 'Your profile, activity and history are deleted. This part cannot be undone.',
    },
  ],
  inApp: {
    title: 'Delete from the app',
    subtitle: 'The quickest way. Works on Android and iPhone.',
    path: ['Account', 'Privacy', 'Delete my account'],
    steps: [
      { title: 'Open VOKVE and go to Account', body: 'It is the last tab at the bottom of the screen.' },
      { title: 'Tap Privacy', body: 'It is in the shortcuts at the top of Account, and opens Privacy & data.' },
      { title: 'Tap Delete my account', body: 'Scroll to the bottom. The sheet that opens explains what happens next — the same as this page.' },
      {
        title: 'Confirm it’s you',
        body: 'Enter your password, or sign in again with Google or Apple if that is how you joined. Add a reason if you want to.',
      },
      {
        title: 'Done — deletion is scheduled',
        body: 'You see the date it will happen. Until then, Cancel deletion on the same screen undoes everything.',
      },
    ],
  },
  confirmation: {
    title: 'Why we ask you to confirm',
    items: [
      {
        icon: 'key-round',
        title: 'Password accounts',
        body: 'You type your password again, so a phone left unlocked on a table cannot end your account.',
      },
      {
        icon: 'scan-face',
        title: 'Google or Apple accounts',
        body: 'You sign in with Google or Apple once more. For Apple accounts, we also revoke VOKVE’s access to your Apple ID.',
      },
    ],
  },
  erased: {
    title: 'What we erase',
    items: [
      'Your name, email, phone number, password and profile photo',
      'Height, weight, date of birth and gender',
      'Steps, distance, workouts, streaks, challenges and badges',
      'Water, meal and vitals logs, and your diet plan',
      'Saved addresses, notifications, support tickets and settings',
      'Every signed-in device and session — all are signed out',
    ],
  },
  retained: {
    title: 'What we keep, and why',
    items: [
      {
        item: 'Orders and the coin ledger, with your identity removed',
        reason: 'Tax and accounting law require us to keep transaction records. They show only “Deleted member”.',
      },
      {
        item: 'Security and fraud signals',
        reason: 'So the same device cannot be used to abuse rewards with a fresh account.',
      },
    ],
  },
  noAccess: {
    title: 'No longer have the app?',
    body: 'Email us from the address on your account and we will verify it’s you, then schedule the deletion for you. The same {{graceDays}}-day window applies.',
    email: '{{email}}',
    subject: 'Account deletion request',
    bodyTemplate:
      'Hello VOKVE team,\n\nPlease delete my VOKVE account.\n\nEmail on the account: \nPhone number on the account: \nReason (optional): \n\nThank you.',
    buttonLabel: 'Email a deletion request',
    note: 'We reply within 24 hours. We never ask for your password by email.',
  },
  export: {
    title: 'Want a copy first?',
    body: 'Download everything we hold about you — profile, activity, workouts, orders, addresses and notifications — as one file. You can do this once a day.',
    path: ['Account', 'Privacy', 'Download my data'],
  },
  faqTitle: 'Common questions',
  faqs: [
    {
      id: 'faq-account-delete',
      category: 'account',
      question: 'How do I delete my account?',
      answer:
        'Account → Privacy → Delete account. Deletion is scheduled {{graceDays}} days ahead so you can change your mind — cancel it from the same screen any time before then. After that your personal data is erased; order and payment records are kept anonymised for accounting.',
      tags: ['delete', 'close account', 'remove', 'gdpr'],
    },
    {
      id: 'faq-account-data',
      category: 'account',
      question: 'Can I get a copy of my data?',
      answer:
        'Yes — Account → Privacy → Download my data gives you a JSON file with your profile, activity, workouts, orders, addresses and notifications. You can ask for one once a day.',
      tags: ['export', 'download', 'copy', 'gdpr', 'data'],
    },
    {
      id: 'del-coins',
      category: 'account',
      question: 'What happens to my coins and orders?',
      answer:
        'Unspent coins are lost when the account is erased, so spend them first if you can. Orders not yet shipped are cancelled; orders on their way are still delivered.',
      tags: ['coins', 'orders'],
    },
    {
      id: 'del-again',
      category: 'account',
      question: 'Can I sign up again later?',
      answer:
        'Yes. Once the deletion is complete you can create a new account with the same email or phone. It starts fresh — nothing from the old account comes back.',
      tags: ['sign up', 'again'],
    },
  ],
};
