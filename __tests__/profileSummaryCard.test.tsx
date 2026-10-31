/**
 * The account card's level, drawn with `config.showProfileLevel` **on**.
 *
 * The level is off in the app for now and is coming back, so the point of
 * this file is that the code behind the flag still works: a block that is
 * only exercised when somebody flips a boolean is a block that has quietly
 * stopped compiling against `ProfileSummary` by the time they do. The flag's
 * off state is covered where it shows — `accountScreen.test.tsx`.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { ProfileSummaryCard } from '../src/components/account/ProfileSummaryCard';
import { ThemeProvider } from '../src/theme';
import type { ProfileSummary } from '../src/types/models';

jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    showProfileLevel: true,
  },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

/** Level 18 sits at 32,400 lifetime coins; the next starts at 36,100. */
const summary: ProfileSummary = {
  level: 18,
  tierTitle: 'Athlo Warrior',
  xp: 33_400,
  xpIntoLevel: 1_000,
  xpForNextLevel: 3_700,
  levelProgress: 1_000 / 3_700,
  memberSince: '2025-05-14T00:00:00.000Z',
  rank: 412,
  totalMembers: 18_940,
  stats: {
    coins: 2_450,
    lifetimeCoins: 33_400,
    currentStreak: 32,
    longestStreak: 48,
    totalSteps: 245_600,
    activeDays: 180,
    totalWorkouts: 26,
    totalWorkoutMinutes: 1_240,
    orders: 2,
    referrals: 3,
  },
  badges: [],
  gaps: [],
  completeness: 75,
  trustTier: 'normal',
};

const render = async (node: React.ReactNode) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>{node}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

describe('ProfileSummaryCard with the level on', () => {
  test('draws the level, its title and the band the member is inside', async () => {
    const text = allText(
      await render(
        <ProfileSummaryCard
          name="Rana Jay"
          summary={summary}
          coins={2_450}
          achievementsEarned={3}
          onPress={() => {}}
        />,
      ),
    );

    expect(text).toContain('Level 18');
    expect(text).toContain('Athlo Warrior');
    // The bar is where the lifetime coins sit inside level 18's own band,
    // never the whole lifetime figure (RULES P4).
    expect(text).toContain('1,000 / 3,700 to level 19');
    // And the rank, which is not part of the level and shows either way.
    expect(text).toContain('#412 of 18.9k');
  });

  test('speaks the level to a screen reader, since the badge is a numeral', async () => {
    const tree = await render(
      <ProfileSummaryCard name="Rana Jay" summary={summary} coins={0} onPress={() => {}} />,
    );

    const labels = tree.root
      .findAll(n => typeof n.props?.accessibilityLabel === 'string')
      .map(n => n.props.accessibilityLabel as string);

    expect(labels).toContain('Rana Jay, level 18, Athlo Warrior. Open profile');
  });

  test('without a summary the level falls back rather than drawing a blank', async () => {
    const text = allText(
      await render(<ProfileSummaryCard name="Rana Jay" summary={null} coins={0} onPress={() => {}} />),
    );

    // Level 1 and "Getting started" until the first sync lands: the card
    // draws rather than appearing from nothing a beat later.
    expect(text).toContain('Level 1');
    expect(text).toContain('Getting started');
    expect(text).not.toContain('to level');
  });
});
