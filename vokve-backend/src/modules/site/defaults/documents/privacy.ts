import { defs, note, p, table, ul } from '../blocks.js';
import type { SiteDocumentInput } from '../types.js';

/**
 * As it ships (RULES P22) — a working draft written from what the app and backend actually do
 * (permissions in the manifests, the privacy switches, RULES P5/P7/P8/P13/P17).
 * It must be reviewed by a lawyer before it is published as the real policy.
 */
export const privacyPolicy: SiteDocumentInput = {
  published: true,
  listing: { show: true, summary: 'What we collect, why, and the controls you have.', icon: 'shield-check', sort: 1 },
  title: 'Privacy Policy',
  eyebrow: 'Legal',
  summary:
    'What VOKVE collects, why it needs it, who helps us run the service, and the controls you have over all of it.',
  version: '1.0',
  effectiveAt: '2026-11-21',
  updatedAt: '2026-11-21',
  highlights: [
    'We collect your steps and workouts so we can pay you coins for them — and for nothing else.',
    'Your health data is never sold and never used for advertising.',
    'Turning a privacy switch off changes what our servers do, not just what the app shows.',
    'You can download your data once a day and delete your account at any time, with a {{graceDays}}-day undo.',
  ],
  sections: [
    {
      id: 'who-we-are',
      title: 'Who we are',
      blocks: [
        p(
          'VOKVE is operated by **VOKVE Fitness** (“VOKVE”, “we”, “us”). This policy explains how we handle personal data when you use the VOKVE app for Android and iPhone, this website, and our support channels (together, the “Service”).',
        ),
        p(
          'For the purposes of India’s Digital Personal Data Protection Act, 2023 and similar laws, VOKVE is the data fiduciary (controller) for the data described here. You can reach us at [{{email}}](mailto:{{email}}).',
        ),
      ],
    },
    {
      id: 'what-we-collect',
      title: 'Information we collect',
      blocks: [
        p('We collect only what the Service needs to work. Here is all of it, and why:'),
        table(
          ['What', 'Examples', 'Why we need it'],
          [
            ['Account details', 'Name, email, phone number, password (stored only as a hash)', 'To create your account, sign you in and reach you about orders or problems'],
            ['Sign-in with Google or Apple', 'The account identifier and email the provider shares with us', 'To let you sign in without a password'],
            ['Profile (optional)', 'Photo, date of birth, gender, height, weight', 'To suggest a step goal, estimate distance and calories, and personalise your profile'],
            ['Activity and health', 'Steps, distance, workouts, streak days; water, meals and vitals you choose to log', 'To count verified steps, pay coins, and show your progress'],
            ['Orders', 'Delivery addresses, order history, payment status', 'To deliver what you redeem and keep proper accounts'],
            ['Device and app', 'Device model, OS and app version, a device identifier, push token, which permissions are granted', 'To keep your sessions secure, send notifications and help when something stops working'],
            ['Integrity signals', 'Google Play Integrity and Apple App Attest results, step-pattern checks', 'To make sure coins are earned fairly and stop fraud'],
            ['Diagnostics', 'Crash reports, app errors, sync status', 'To find and fix faults'],
            ['Usage (optional)', 'Which screens you open and features you use', 'To improve the app — you can switch this off'],
            ['Support', 'Messages you send us and tickets you open', 'To answer you'],
          ],
        ),
        note(
          'success',
          'What we don’t collect',
          'We do not collect your precise location, your contacts, or your messages, and we never read payment card numbers — those go straight to the payment provider.',
        ),
      ],
    },
    {
      id: 'health-data',
      title: 'Health and activity data',
      blocks: [
        p(
          'On Android, VOKVE reads **steps and distance** from Health Connect and your phone’s step sensor, with your permission. On iPhone, it reads steps from **Motion & Fitness** and **Apple Health**, with your permission. We do not read any other kind of health record from those services.',
        ),
        p(
          'Water, meals, heart rate and blood pressure appear in VOKVE only if you type them in yourself. VOKVE does not measure vitals with your phone’s sensors.',
        ),
        ul(
          'Health data is used to count your verified steps, pay coins, run challenges and streaks, and show you your own progress.',
          'It is **never sold**, never used for advertising, and never shared with data brokers.',
          'Data obtained through Health Connect and Apple HealthKit is used in line with the Health Connect Permissions Policy and Apple’s HealthKit guidelines, including their limits on use and transfer.',
          'You can withdraw permission at any time in your phone’s settings. The app keeps working; it simply stops counting steps for coins.',
        ),
      ],
    },
    {
      id: 'how-we-use',
      title: 'How we use your information',
      blocks: [
        ul(
          'Provide the Service: your account, step tracking, workouts, streaks, challenges, the leaderboard, the wallet and the shop.',
          'Verify activity and protect the coin economy from fraud, including device and integrity checks.',
          'Process and deliver orders, handle cancellations, returns and refunds.',
          'Send the notifications you have turned on — reminders, order updates, security alerts.',
          'Answer support requests and diagnose problems with your app.',
          'Keep the Service secure, including detecting unusual sign-ins.',
          'Meet our legal, tax and accounting obligations.',
          'Improve the app using usage information, if you have left usage analytics on.',
        ),
      ],
    },
    {
      id: 'legal-bases',
      title: 'Why we are allowed to use it',
      blocks: [
        defs([
          ['Consent', 'For health and activity data, optional profile details, notifications and usage analytics. You can withdraw consent at any time.'],
          ['Providing the Service', 'For your account, orders and support — we cannot run the Service without it.'],
          ['Legitimate uses permitted by law', 'For security, fraud prevention and keeping the Service working.'],
          ['Legal obligations', 'For tax, accounting and responding to lawful requests.'],
        ]),
      ],
    },
    {
      id: 'sharing',
      title: 'Who we share it with',
      blocks: [
        p('We do not sell personal data. We share it only with service providers who help us run VOKVE, under contracts that limit what they can do with it:'),
        table(
          ['Provider', 'What they do for us'],
          [
            ['Cloud hosting and database providers', 'Store and serve the Service’s data'],
            ['Google Firebase', 'Phone-number verification, push notifications, crash reports and performance monitoring'],
            ['Google and Apple', 'Sign-in with Google / Apple, and Play Integrity / App Attest checks'],
            ['Payment gateway', 'Processes card, UPI and net-banking payments for shop orders'],
            ['Delivery partners', 'Receive your name, address and phone number to deliver an order'],
            ['Email delivery provider', 'Sends verification codes and account emails'],
          ],
        ),
        p(
          'We may also disclose information if the law requires it, to protect the rights and safety of our members or the public, or as part of a merger or acquisition — in which case this policy continues to protect your data.',
        ),
      ],
    },
    {
      id: 'what-others-see',
      title: 'What other members can see',
      blocks: [
        ul(
          'The weekly leaderboard shows your **first name and rank** — never the readings behind it.',
          'Reviews you write in the shop show your name and photo next to them.',
          'If you joined with a friend’s invite code, they see your name in their referrals list only if you allow it. Otherwise they see “A friend”.',
        ),
      ],
    },
    {
      id: 'your-choices',
      title: 'Your choices',
      blocks: [
        p('Open **Account → Privacy** in the app. Each switch changes what our servers do:'),
        defs([
          ['Usage analytics', 'Off, and the usage events your app sends are dropped on arrival.'],
          ['Personalised offers', 'Off, and messages targeted at you personally are not sent at all.'],
          ['Show my name to whoever invited me', 'Off, and your inviter sees “A friend” instead of your name.'],
        ]),
        p(
          'You can also choose which notifications you get, and set quiet hours, under **Account → Notifications**, and revoke step, notification, camera or photo permissions in your phone’s settings.',
        ),
        note(
          'info',
          null,
          'Crash reports, sync status and permission states are kept even with usage analytics off. They are how support can tell why your steps stopped counting — not a measure of what interests you.',
        ),
      ],
    },
    {
      id: 'retention',
      title: 'How long we keep it',
      blocks: [
        table(
          ['Data', 'How long'],
          [
            ['Your account, profile, activity and health logs', 'Until you delete your account (plus the {{graceDays}}-day window in which you can cancel)'],
            ['Usage events', 'Up to 400 days'],
            ['Crash and error reports', 'Up to 30 days'],
            ['Orders and the coin ledger', 'Kept after deletion in anonymised form, for accounting and tax law'],
            ['Fraud signals and security logs', 'Kept to stop the same device being used to abuse the Service again'],
          ],
        ),
      ],
    },
    {
      id: 'your-rights',
      title: 'Your rights',
      blocks: [
        ul(
          '**Access and copy** — Account → Privacy → Download my data gives you everything as one file, once every 24 hours.',
          '**Correction** — edit your profile any time; email and phone changes are verified with a code.',
          '**Erasure** — delete your account from the app, or follow the steps on our [account deletion page](/delete-account).',
          '**Withdraw consent** — use the privacy switches or your phone’s permission settings.',
          '**Grievance** — write to our Grievance Officer at [{{grievanceEmail}}](mailto:{{grievanceEmail}}); we acknowledge within 24 hours and aim to resolve within 30 days.',
          '**Nominate** — you may nominate someone to exercise these rights on your behalf if you are unable to.',
        ),
      ],
    },
    {
      id: 'security',
      title: 'How we protect it',
      blocks: [
        ul(
          'All traffic between the app and our servers is encrypted in transit.',
          'Passwords are stored only as strong one-way hashes; sign-in tokens are kept in your phone’s secure storage (Keychain on iPhone).',
          'Sessions are bound to a device, and you can see and sign out every device from Account → Security.',
          'Staff access is limited by role, protected by two-factor authentication, and logged.',
        ),
        p('No system is perfectly secure. If a breach affects your data, we will tell you and the authorities as the law requires.'),
      ],
    },
    {
      id: 'children',
      title: 'Children',
      blocks: [
        p(
          'VOKVE is meant for adults. If you are under 18, you may use VOKVE only with the verifiable consent of a parent or guardian. If we learn that we hold a child’s data without that consent, we will delete it.',
        ),
      ],
    },
    {
      id: 'transfers',
      title: 'Where your data is stored',
      blocks: [
        p(
          'Our service providers may store or process data outside India. Where they do, we rely on contractual safeguards and only use countries the law permits.',
        ),
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      blocks: [
        p(
          'When we change this policy we update the date at the top. If a change is significant, we tell you in the app before it takes effect.',
        ),
      ],
    },
    {
      id: 'contact',
      title: 'Contact us',
      blocks: [
        p(
          'Questions, requests or complaints: [{{email}}](mailto:{{email}}), or open a ticket from **Help & Support** in the app. You can also see all our [contact options](/contact).',
        ),
      ],
    },
  ],
};
