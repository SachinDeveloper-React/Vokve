import { note, ol, p, table, ul } from '../blocks.js';
import type { SiteDocumentInput } from '../types.js';

/**
 * As it ships (RULES P22) — the refund and shipping policies payment gateways ask for. Fees,
 * the delivery window and the returns window are ⚙ `commerce.*` values
 * (shippingFeePaise 4900, freeShippingAbovePaise 99900, deliveryDaysMin/Max
 * 4–7, returnWindowDays 7, paymentWindowMinutes 30).
 */
export const refundPolicy: SiteDocumentInput = {
  published: true,
  listing: { show: true, summary: 'Cancelling, returning and getting your money back.', icon: 'rotate-ccw', sort: 4 },
  title: 'Refunds & Cancellations',
  eyebrow: 'Legal',
  summary: 'How to cancel an order, return an item, and when your money and coins come back.',
  version: '1.0',
  effectiveAt: '2026-11-21',
  updatedAt: '2026-11-21',
  highlights: [
    'Cancel free of charge any time before your order ships.',
    'Coins come back to your wallet instantly; money goes back to where it came from.',
    'Return eligible items within {{returnWindowDays}} days of delivery.',
    'Damaged or wrong item? Tell us within 48 hours and we will put it right.',
  ],
  sections: [
    {
      id: 'cancelling',
      title: 'Cancelling an order',
      blocks: [
        p(
          'Open **My Orders**, choose the order and tap **Cancel** — any time before it ships. Nothing is charged for cancelling.',
        ),
        ul(
          'Coins you spent on it return to your wallet straight away.',
          'Any money you paid is refunded to the same card, UPI account or bank account.',
          'An order that is not paid within 30 minutes is released automatically, and nothing is taken.',
        ),
        p('Once an order has shipped it can no longer be cancelled, but you can return it as described below.'),
      ],
    },
    {
      id: 'returns',
      title: 'Returns',
      blocks: [
        p(
          'You can return most items within **{{returnWindowDays}} days of delivery**, unused, in their original packaging and with any tags attached. Some items cannot be returned for hygiene reasons — for example opened consumables or personal-care products. A product’s page says when it cannot be returned.',
        ),
        ol(
          'Open a ticket from **Help & Support** in the app and pick the order from **My Orders**.',
          'Tell us which item and why. A photo helps.',
          'We arrange the pickup or tell you where to send it.',
          'Once the item reaches us and passes inspection, we start your refund.',
        ),
      ],
    },
    {
      id: 'damaged',
      title: 'Damaged, faulty or wrong items',
      blocks: [
        p(
          'If something arrives damaged, faulty, incomplete or isn’t what you ordered, let us know within **48 hours of delivery** with a photo of the item and the packaging. We will send a replacement or refund you in full, including delivery.',
        ),
      ],
    },
    {
      id: 'timing',
      title: 'When your refund arrives',
      blocks: [
        table(
          ['Paid with', 'Refunded to', 'Usually arrives'],
          [
            ['Coins', 'Your VOKVE wallet', 'Instantly'],
            ['UPI', 'The same UPI account', '2–5 working days'],
            ['Card', 'The same card', '5–7 working days'],
            ['Net banking', 'The same bank account', '5–7 working days'],
          ],
        ),
        p('We start money refunds within 2 working days of a cancellation or an approved return. After that the timing depends on your bank.'),
      ],
    },
    {
      id: 'delivery-fees',
      title: 'Delivery fees',
      blocks: [
        p('Delivery fees are refunded when you cancel before shipping, or when an item is damaged, faulty or wrong. They are not refunded when you return an item you changed your mind about.'),
      ],
    },
    {
      id: 'not-refundable',
      title: 'What cannot be refunded',
      blocks: [
        ul(
          'Coins themselves — they can never be exchanged for money.',
          'Coins spent restoring a streak.',
          'Coins that expired or were reversed under our [Coins & Fair Play policy](/rewards-policy).',
        ),
        note('info', null, 'Nothing here affects your rights under consumer protection law.'),
      ],
    },
    {
      id: 'contact',
      title: 'Need help?',
      blocks: [p('Open a ticket from **Help & Support** in the app, or write to [{{email}}](mailto:{{email}}).')],
    },
  ],
};

export const shippingPolicy: SiteDocumentInput = {
  published: true,
  listing: { show: true, summary: 'Where we deliver, what it costs and how long it takes.', icon: 'truck', sort: 5 },
  title: 'Shipping & Delivery',
  eyebrow: 'Legal',
  summary: 'Where we deliver, what it costs, how long it takes and how to follow your parcel.',
  version: '1.0',
  effectiveAt: '2026-11-21',
  updatedAt: '2026-11-21',
  highlights: [
    'We deliver across India.',
    'Delivery is ₹49, and free on orders over ₹999.',
    'Your order shows a delivery window of {{deliveryDays}} days from the moment you place it.',
    'You get a tracking link and a notification as soon as it ships.',
  ],
  sections: [
    {
      id: 'where',
      title: 'Where we deliver',
      blocks: [
        p('We deliver to addresses in India that our courier partners serve. If we cannot reach a PIN code, checkout tells you before you pay.'),
      ],
    },
    {
      id: 'cost',
      title: 'Delivery charges',
      blocks: [
        table(
          ['Order value (items)', 'Delivery'],
          [
            ['Up to ₹999', '₹49'],
            ['Over ₹999', 'Free'],
          ],
        ),
        p('Delivery is paid in coins with the rest of the order, at the same {{coinValue}} a coin.'),
      ],
    },
    {
      id: 'timing',
      title: 'How long it takes',
      blocks: [
        ul(
          'Orders are usually packed and handed to the courier within 1–2 working days.',
          'Each order shows its delivery window — normally {{deliveryDays}} days after you place it.',
          'Remote areas, public holidays and severe weather can add a few days. We tell you in the app if your order is running late.',
        ),
      ],
    },
    {
      id: 'tracking',
      title: 'Tracking your order',
      blocks: [
        p('**My Orders** shows every order and the stage it has reached. When it ships you get a notification and a tracking reference you can follow live.'),
      ],
    },
    {
      id: 'changes',
      title: 'Changing the address',
      blocks: [
        p('Until your order is packed you can send it to another of your saved addresses from the order page. After that, contact support and we will do what we can with the courier.'),
      ],
    },
    {
      id: 'delivery',
      title: 'On delivery day',
      blocks: [
        ul(
          'Delivery partners may call you to confirm the address or the delivery.',
          'If nobody is available, the courier tries again. A parcel that cannot be delivered comes back to us, and we contact you to send it again or refund it.',
          'Check the parcel when it arrives. If anything is damaged, tell us within 48 hours — see our [Refund policy](/refund-policy).',
        ),
      ],
    },
    {
      id: 'contact',
      title: 'Questions',
      blocks: [p('Write to [{{email}}](mailto:{{email}}) or open a ticket from **Help & Support** in the app.')],
    },
  ],
};
