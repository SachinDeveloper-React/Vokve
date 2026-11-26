import { note, p, ul } from '../blocks.js';
import type { SiteDocumentInput } from '../types.js';

/** As it ships (RULES P22) — a working draft for legal review, not final terms. */
export const termsAndConditions: SiteDocumentInput = {
  published: true,
  listing: { show: true, summary: 'The agreement between you and VOKVE.', icon: 'file-text', sort: 2 },
  title: 'Terms & Conditions',
  eyebrow: 'Legal',
  summary: 'The agreement between you and VOKVE when you use the app, earn coins and order from the shop.',
  version: '1.0',
  effectiveAt: '2026-11-21',
  updatedAt: '2026-11-21',
  highlights: [
    'One account per person, with an email and phone number that are really yours.',
    'Coins are rewards, not money — they cannot be bought, sold, transferred or cashed out.',
    'VOKVE is a wellness app, not a medical service.',
    'Faking activity costs you the coins it earned, and can cost you the account.',
  ],
  sections: [
    {
      id: 'agreement',
      title: 'About these terms',
      blocks: [
        p(
          'These terms are an agreement between you and **VOKVE Fitness** (“VOKVE”, “we”, “us”). By creating an account or using the VOKVE app or website (the “Service”) you agree to them, to our [Privacy Policy](/privacy) and to the [Coins & Fair Play policy](/rewards-policy).',
        ),
        p('If you do not agree, please do not use the Service.'),
      ],
    },
    {
      id: 'eligibility',
      title: 'Who can use VOKVE',
      blocks: [
        ul(
          'You must be 18 or older, or use VOKVE with the consent of a parent or guardian.',
          'You must be able to form a binding contract under the laws of India.',
          'Shop orders can be delivered only to addresses we serve, listed in our [Shipping policy](/shipping-policy).',
        ),
      ],
    },
    {
      id: 'account',
      title: 'Your account',
      blocks: [
        ul(
          'Keep one account per person. Give us accurate details, and keep your email and phone number current — both are verified with a code.',
          'Keep your sign-in details to yourself. You are responsible for what happens under your account.',
          'An account can be signed in on a limited number of devices at once; you can see and sign out each one from Account → Security.',
          'Tell us at once at [{{email}}](mailto:{{email}}) if you think someone else has access.',
        ),
      ],
    },
    {
      id: 'wellness',
      title: 'Health and wellness',
      blocks: [
        note(
          'warning',
          'Not medical advice',
          'VOKVE helps you build healthy habits. It does not diagnose, treat or prevent any condition. Readings you log, step goals and diet plans are general wellness information. Talk to a doctor before starting a new exercise or diet programme, and about any reading that worries you.',
        ),
        p('Exercise sensibly and within your limits. You take part in any activity at your own risk.'),
      ],
    },
    {
      id: 'coins',
      title: 'Coins',
      blocks: [
        ul(
          'Coins are reward points you earn by using the Service. They have **no cash value**, are not your property, and cannot be bought, sold, transferred, gifted or exchanged for money.',
          'You can spend coins only in the VOKVE shop, on the share of an order the shop allows.',
          'How coins are earned, capped, held for verification and expire is set out in the [Coins & Fair Play policy](/rewards-policy).',
          'We may reverse coins earned in breach of these terms or by mistake.',
        ),
      ],
    },
    {
      id: 'shop',
      title: 'The VOKVE shop',
      blocks: [
        ul(
          'Prices are shown in Indian rupees and include applicable taxes unless stated otherwise. Orders are paid in coins, delivery included, and checkout shows the total before you confirm.',
          'An order is accepted when we confirm it. If an item becomes unavailable or was listed at an obviously wrong price, we may cancel the order and return everything you paid, coins included.',
          'An unpaid order is released after its payment window and nothing is charged.',
          'Cancellations, returns and refunds follow our [Refund policy](/refund-policy); delivery follows our [Shipping policy](/shipping-policy).',
        ),
      ],
    },
    {
      id: 'acceptable-use',
      title: 'Playing fair',
      blocks: [
        p('You agree not to:'),
        ul(
          'fake activity — shake or mechanically move a phone, use apps or devices that invent steps, or run the app on emulators or modified systems to tamper with it;',
          'open more than one account, or use other people’s devices or accounts to earn coins or referral rewards;',
          'automate, scrape, reverse-engineer or interfere with the Service or its security;',
          'post anything unlawful, abusive or misleading in reviews or support messages;',
          'use the Service to break any law.',
        ),
        p('If you do, we may withhold or reverse coins, cancel orders, and suspend or close your account.'),
      ],
    },
    {
      id: 'your-content',
      title: 'What you post',
      blocks: [
        p(
          'You keep ownership of reviews, photos and messages you submit. You give us a licence to display and use them to run and promote the Service. We may remove content that breaks these terms.',
        ),
      ],
    },
    {
      id: 'our-rights',
      title: 'Our intellectual property',
      blocks: [
        p(
          'The VOKVE name, logo, app and website, and everything in them that is not your content, belong to us or our licensors. We give you a personal, non-transferable licence to use the app on devices you own. Open-source components are licensed under their own terms, listed on our [licences page](/licenses).',
        ),
      ],
    },
    {
      id: 'third-parties',
      title: 'Other services',
      blocks: [
        p(
          'VOKVE works with services run by others — Health Connect, Apple Health, Google and Apple sign-in, app stores, payment gateways and couriers. Their own terms apply to your use of them, and we are not responsible for them.',
        ),
      ],
    },
    {
      id: 'changes-to-service',
      title: 'Changes to the Service',
      blocks: [
        p(
          'We keep improving VOKVE, so features, challenges, rewards and earning rates can change. We may require you to update the app to keep using it. We will give notice of changes that materially reduce what you get, except where we must act quickly for security or legal reasons.',
        ),
      ],
    },
    {
      id: 'ending',
      title: 'Suspension and closing your account',
      blocks: [
        p(
          'You can delete your account at any time — see [how account deletion works](/delete-account). We may suspend or close an account that breaks these terms, puts others at risk, or where the law requires it. Where we can, we will tell you why.',
        ),
        p('When an account is closed, unspent coins are forfeited. Orders already shipped are still delivered.'),
      ],
    },
    {
      id: 'liability',
      title: 'Our responsibility to you',
      blocks: [
        p(
          'We work hard to keep VOKVE accurate and available, but step counts depend on your phone and its sensors, and the Service is provided “as is”. To the extent the law allows, we are not liable for indirect or consequential loss, and our total liability to you is limited to the amount you paid us in the 12 months before the claim.',
        ),
        p('Nothing in these terms limits rights you have under consumer protection law that cannot be limited.'),
      ],
    },
    {
      id: 'law',
      title: 'Governing law and disputes',
      blocks: [
        p(
          'These terms are governed by the laws of India. Please talk to us first — most problems are solved with one message to support. Any dispute that cannot be resolved that way falls under the jurisdiction of the courts of India.',
        ),
      ],
    },
    {
      id: 'changes',
      title: 'Changes to these terms',
      blocks: [
        p(
          'We may update these terms. We change the date at the top when we do, and tell you in the app before significant changes take effect. Continuing to use VOKVE after that means you accept the new terms.',
        ),
      ],
    },
    {
      id: 'contact',
      title: 'Contact us',
      blocks: [p('Write to [{{email}}](mailto:{{email}}) or see our [contact page](/contact).')],
    },
  ],
};
