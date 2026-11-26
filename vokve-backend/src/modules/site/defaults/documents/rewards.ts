import { note, p, table, ul } from '../blocks.js';
import type { SiteDocumentInput } from '../types.js';

/**
 * As it ships (RULES P22). The figures that are ⚙ values — the daily ceiling,
 * the steps' share of it, expiry, coin value, invite rewards — are tokens the
 * server fills from config on the way out, so the policy cannot disagree with
 * what the server pays. The rest (streak milestones, hold windows) are still
 * written out: change them here when the config changes.
 */
export const rewardsPolicy: SiteDocumentInput = {
  published: true,
  listing: { show: true, summary: 'How coins are earned, verified, capped and spent.', icon: 'coins', sort: 3 },
  title: 'Coins & Fair Play',
  eyebrow: 'Legal',
  summary: 'How coins are earned, verified, capped, spent and — rarely — taken back.',
  version: '1.0',
  effectiveAt: '2026-11-21',
  updatedAt: '2026-11-21',
  highlights: [
    'Coins are rewards for what you do — they have no cash value and cannot be withdrawn.',
    'You can earn up to {{dailyCoinCap}} coins a day across everything; the day resets at midnight where you are.',
    'Step coins are held briefly while we check the day, then released.',
    'Coins expire after {{coinExpiryDays}} days without a step sync — and we warn you twice first.',
  ],
  sections: [
    {
      id: 'what-coins-are',
      title: 'What coins are',
      blocks: [
        p(
          'Coins are VOKVE’s reward points. You earn them by being active and spend them in the VOKVE shop. They are not money, cannot be bought, and cannot be sold, transferred, gifted or exchanged for cash.',
        ),
      ],
    },
    {
      id: 'earning',
      title: 'How you earn',
      blocks: [
        table(
          ['Activity', 'What it pays'],
          [
            ['Verified steps', '0.095 coins for every 100 verified steps'],
            ['Workouts', '100 coins for a finished workout of 10 minutes or more, up to 2 a day'],
            ['Streak milestones', '50 coins at 7 days, 150 at 15, 300 at 30, 1,000 at 90 and 2,000 at 180'],
            ['Challenges', 'The reward shown on each challenge, once per challenge you complete'],
            ['Inviting friends', '{{inviterReward}} coins for you and {{inviteReward}} for your friend, up to 10 rewarded invites a month'],
            ['Weekly leaderboard', '5,000 coins for 1st, 3,000 for 2nd–3rd and 1,000 for 4th–10th, plus any prizes shown'],
          ],
        ),
        p('Rates can change. The app always shows what each activity pays today.'),
      ],
    },
    {
      id: 'daily-ceiling',
      title: 'The daily ceiling',
      blocks: [
        p(
          'You can earn up to **{{dailyCoinCap}} coins a day** from all activities combined. Steps can contribute up to {{stepsCoinCap}} of those. Anything past the ceiling that day pays nothing, and the count resets at midnight in your time zone.',
        ),
        note(
          'info',
          'Why there is a ceiling',
          'It keeps the economy fair: no single day, bug or trick can pay without limit. Weekly leaderboard prizes are the one exception and are paid on top.',
        ),
      ],
    },
    {
      id: 'verification',
      title: 'How steps are verified',
      blocks: [
        ul(
          'Steps are counted by your phone and its health service, then checked by our servers against how genuine walking looks.',
          'Step coins first appear as **pending**. They are released to your wallet after a holding window of between 1 and 7 days, depending on your account’s history.',
          'A day that does not check out pays fewer coins, or none. You can always see why in Coin History.',
        ),
      ],
    },
    {
      id: 'expiry',
      title: 'When coins expire',
      blocks: [
        p(
          'Coins expire after **{{coinExpiryDays}} days without a step sync**. Every time your phone sends its steps the {{coinExpiryDays}} days start again, however few steps there were. Earning coins in other ways, or spending them, does not restart the clock. We remind you 14 days and 3 days before anything expires.',
        ),
      ],
    },
    {
      id: 'spending',
      title: 'Spending coins',
      blocks: [
        ul(
          'In the shop, each coin is worth {{coinValue}} of the price of the items.',
          'Orders are paid in coins alone, delivery included. No card, UPI or bank payment is taken.',
          'Checkout shows the total in coins before anything is taken.',
          'Coins spent on an order you cancel before it ships go straight back to your wallet.',
        ),
      ],
    },
    {
      id: 'not-allowed',
      title: 'What isn’t allowed',
      blocks: [
        ul(
          'Shaking, swinging or mechanically moving a phone to add steps.',
          'Using apps, devices or emulators that create or alter step data.',
          'Running more than one account, or sharing a device to claim extra rewards or referral bonuses.',
          'Tampering with the app, its traffic or its security checks.',
        ),
        p(
          'If we find any of these, we may withhold or reverse the coins involved, cancel orders paid with them, and suspend or close the account. If you think we got it wrong, write to us and a person will review it.',
        ),
      ],
    },
    {
      id: 'changes',
      title: 'Changes',
      blocks: [
        p(
          'We may change earning rates, challenges, the ceiling or the shop’s coin share. Changes apply from the moment they are published and do not reduce coins already in your wallet, except where coins are reversed under this policy.',
        ),
      ],
    },
    {
      id: 'contact',
      title: 'Questions',
      blocks: [p('Coin History in the app explains every credit. For anything else, write to [{{email}}](mailto:{{email}}).')],
    },
  ],
};
