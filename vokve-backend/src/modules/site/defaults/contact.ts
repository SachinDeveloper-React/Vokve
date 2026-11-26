import type { z } from 'zod';
import type { contactEditSchema } from '../../../contracts/site.js';

/**
 * The Contact page as it ships (RULES P22). The channels carry tokens, not
 * numbers: `{{email}}`, `{{phone}}`, `{{whatsapp…}}` and `{{hours}}` are
 * filled by the website from the details on Contact & links, and a channel
 * whose link needs a detail that is not set — no phone, no WhatsApp — is
 * left out. The form's messages land on the panel's Enquiries page.
 */
export const DEFAULT_CONTACT: z.input<typeof contactEditSchema> = {
  seo: {
    title: 'Contact us',
    description: 'Reach the VOKVE support team by email, phone or from inside the app.',
  },
  hero: {
    eyebrow: 'Contact',
    title: 'Talk to a person',
    subtitle: 'Questions about coins, an order or your account — we read every message and we usually reply within a day.',
  },
  channels: [
    {
      icon: 'mail',
      tone: 'blue',
      title: 'Email',
      value: '{{email}}',
      href: 'mailto:{{email}}',
      note: '{{responseTime}}',
    },
    {
      icon: 'phone',
      tone: 'green',
      title: 'Phone',
      value: '{{phoneDisplay}}',
      href: 'tel:{{phone}}',
      note: '{{hours}}',
    },
    {
      icon: 'message-circle',
      tone: 'cyan',
      title: 'WhatsApp',
      value: '{{whatsappDisplay}}',
      href: '{{whatsappLink}}',
      note: '{{hours}}',
    },
    {
      icon: 'message-circle',
      tone: 'violet',
      title: 'In the app',
      value: 'Help & Support',
      href: null,
      note: 'Fastest for anything about your account — your app version and device are attached for you.',
    },
  ],
  inApp: {
    title: 'Already using VOKVE?',
    body: 'Open a ticket from the app. It carries your app version and device automatically, and the conversation stays in one place.',
    path: ['Account', 'Help & Support', 'Report an Issue'],
  },
  companyTitle: 'Company details',
  grievanceNote:
    'Complaints about your data or an order can be sent to our Grievance Officer. We acknowledge them within 24 hours and aim to resolve them within 30 days.',
  form: {
    title: 'Send us a message',
    subtitle: 'Not a member yet, or writing about something other than your account? Tell us here and a person will reply by email.',
    nameLabel: 'Your name',
    emailLabel: 'Email',
    phoneLabel: 'Phone (optional)',
    topicLabel: 'What is it about?',
    topics: ['A question about VOKVE', 'Coins and rewards', 'An order', 'My account', 'Privacy or my data', 'Business or press', 'Something else'],
    messageLabel: 'Your message',
    messagePlaceholder: 'Tell us as much as you can — an order number or the email on your account helps.',
    consent: 'We use these details only to answer you. See our [Privacy Policy](/privacy).',
    submitLabel: 'Send message',
    sendingLabel: 'Sending…',
    successTitle: 'Thanks — your message is with us',
    successBody: 'A person will read it and reply to the email you gave. {{responseTime}}',
    errorBody: 'Your message could not be sent just now. Please try again in a minute, or email us at [{{email}}](mailto:{{email}}).',
    rateLimitedBody: 'You have sent us several messages already today. We will answer those first — or email us at [{{email}}](mailto:{{email}}).',
  },
};
