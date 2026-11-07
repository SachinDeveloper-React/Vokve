/**
 * The day a coin row is *for*, under the time it landed (D-92).
 *
 * A phone closes its day at local midnight and uploads it the next morning;
 * a watch backfills a fortnight at once. So four challenge rows can land
 * inside two minutes and belong to four different days, and with only a
 * clock time under each the one reading left to a member is that the same
 * challenge paid them four times. These check the row says which day it is
 * about — and stays quiet on the ordinary row, where it would be noise.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { textOf } from './helpers/text';
import { CoinTransactionRow } from '../src/components/wallet/CoinTransactionRow';
import { ThemeProvider } from '../src/theme';
import type { CoinTransaction } from '../src/types/models';

const row = (over: Partial<CoinTransaction> = {}): CoinTransaction => ({
  id: 'c-1',
  title: 'check completed',
  source: 'challenge',
  amount: 10,
  createdAt: '2026-11-05T14:10:50.000Z',
  earnedFor: null,
  ...over,
});

function render(transaction: CoinTransaction): string {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <CoinTransactionRow transaction={transaction} when="time" />
      </ThemeProvider>,
    );
  });
  const text = textOf(tree, RNText);
  ReactTestRenderer.act(() => tree.unmount());
  return text;
}

describe('a coin row that paid for an earlier day', () => {
  const creditedOn = '2026-11-05';

  it('says which day it is for', () => {
    const text = render(
      row({ earnedFor: { start: '2026-11-02', end: '2026-11-02', label: 'For 2 Nov' } }),
    );
    expect(text).toContain('For 2 Nov');
  });

  it('tells two rows of the same challenge apart by their days', () => {
    const second = render(
      row({ id: 'c-2', earnedFor: { start: '2026-11-03', end: '2026-11-03', label: 'For 3 Nov' } }),
    );
    expect(second).toContain('For 3 Nov');
    expect(second).not.toContain('For 2 Nov');
  });

  it('stays quiet when the coins are for the day they landed on', () => {
    const text = render(
      row({ earnedFor: { start: creditedOn, end: creditedOn, label: 'For 5 Nov' } }),
    );
    expect(text).not.toContain('For 5 Nov');
  });

  it('names a week even when it ends on the day the coins landed', () => {
    // "the week of 26 Oct" is not something a timestamp can imply, so a
    // span always says so.
    const text = render(
      row({
        title: 'Leaderboard #2',
        createdAt: '2026-11-01T09:00:00.000Z',
        earnedFor: { start: '2026-10-26', end: '2026-11-01', label: 'For the week of 26 Oct' },
      }),
    );
    expect(text).toContain('For the week of 26 Oct');
  });

  it('says nothing extra for a row that is not about a day', () => {
    const text = render(row({ title: 'Training Shorts', source: 'purchase', amount: -2992 }));
    expect(text).toContain('Training Shorts');
    expect(text).not.toContain('For ');
  });
});
