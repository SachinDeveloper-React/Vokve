
import type { z } from 'zod';
import type { aboutEditSchema } from '../../../contracts/site.js';

/** The About page as it ships (RULES P22). `team: null` hides that section. */
export const DEFAULT_ABOUT: z.input<typeof aboutEditSchema> = {
  seo: {
    title: 'About us',
    description:
      'Why we built VOKVE: a fitness app that rewards the walking people already do — honestly, privately and without a gadget.',
  },
  hero: {
    eyebrow: 'About VOKVE',
    title: 'We think a good habit should pay you back',
    subtitle:
      'VOKVE started with a simple question: millions of people walk every day, so why does none of it count for anything?',
  },
  story: {
    eyebrow: 'Our story',
    title: 'Small steps, counted honestly',
    paragraphs: [
      'Most fitness apps reward the people who are already fit. We wanted to reward everyone else too — the walk to the station, the evening lap of the colony, the stairs instead of the lift.',
      'So we built VOKVE around the one device everybody already carries. It counts your steps, checks that they are real, and turns them into coins you can spend on things you actually want.',
      'The hard part was never the counting. It was making the coins mean something — which is why every day is verified, every coin is earned, and the rules are written down for anyone to read.',
    ],
    quote: {
      text: 'If a reward can be faked, it isn’t a reward. Everything we build starts from that.',
      attribution: 'The VOKVE team',
    },
  },
  numbers: [
    { value: '1 phone', label: 'is all you need' },
    { value: '4 layers', label: 'of step verification' },
    { value: '0', label: 'health records ever sold' },
    { value: '24 h', label: 'to answer your message' },
  ],
  values: {
    eyebrow: 'What we stand for',
    title: 'Four promises we build against',
    subtitle: null,
    items: [
      {
        icon: 'badge-check',
        tone: 'green',
        title: 'Earned, not given',
        body: 'Every coin traces back to something you did. No lucky spins, no coins for watching ads.',
      },
      {
        icon: 'lock',
        tone: 'violet',
        title: 'Private by default',
        body: 'Your health data pays you and shows you your progress. It is never sold and never shared for advertising.',
      },
      {
        icon: 'scale',
        tone: 'gold',
        title: 'Fair for everyone',
        body: 'The same caps, checks and rules apply to every member, and they are published in plain words.',
      },
      {
        icon: 'heart',
        tone: 'brand',
        title: 'Kind to real life',
        body: 'Missed a day? Freezes save streaks, goals adjust to you, and quiet hours keep notifications polite.',
      },
    ],
  },
  milestones: {
    eyebrow: 'Along the way',
    title: 'How VOKVE came together',
    subtitle: null,
    items: [
      {
        when: 'The idea',
        title: 'Walking should count',
        body: 'We set out to reward the everyday walker, not just the athlete.',
      },
      {
        when: 'The engine',
        title: 'Verification first',
        body: 'Before a single coin was paid, we built the checks that keep coins honest.',
      },
      {
        when: 'The shop',
        title: 'Rewards you can hold',
        body: 'Coins became real products from the VOKVE shop, with the total shown before you confirm.',
      },
      {
        when: 'Today',
        title: 'Android and iPhone',
        body: 'The same verified steps and the same rewards, on both kinds of phone.',
      },
    ],
  },
  team: null,
  cta: {
    title: 'Come walk with us',
    body: 'Download VOKVE and your next walk starts counting.',
    primary: { label: 'Get the app', href: '/#download' },
    secondary: { label: 'Talk to us', href: '/contact' },
  },
};
