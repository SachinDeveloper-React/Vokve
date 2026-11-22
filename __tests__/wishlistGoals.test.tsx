/**
 * Saving up for what is on the wishlist (RULES R20): the arithmetic between
 * the server's goal and the wallet, the order the goals are shown in, the
 * words, the "Saving For" card that Home, the wallet and the shop draw,
 * and the store that keeps the saved items fresh enough to draw it.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text as RNText } from 'react-native';
import { WishlistGoalsCard } from '../src/components/shop/WishlistGoalsCard';
import { shopItems } from '../src/constants/seedData';
import { mmkvStorage } from '../src/stores';
import { useWishlistStore } from '../src/stores/wishlistStore';
import { ThemeProvider } from '../src/theme';
import type { ShopItem } from '../src/types/models';
import {
  coinGoalOf,
  countReady,
  itemCoinGoal,
  itemGoalStatus,
  orderGoalStatus,
  rankCoinGoals,
} from '../src/utils/coinGoal';
import { textOf } from './helpers/text';

jest.mock('../src/services/api/endpoints', () => ({
  ...jest.requireActual('../src/services/api/endpoints'),
  wishlistApi: {
    ids: jest.fn(),
    list: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
  },
}));

const { wishlistApi } = jest.requireMock('../src/services/api/endpoints') as {
  wishlistApi: { ids: jest.Mock; list: jest.Mock };
};

const item = (id: string): ShopItem => {
  const found = shopItems.find(entry => entry.id === id);
  if (!found) throw new Error(`No seed item ${id}`);
  return found;
};

describe('the goal of an item', () => {
  test('the catalogue the app paints with carries the server figures (backend commerce test)', () => {
    // A coins reward: ₹349 → 1,396 coins, and 196 to ship it.
    expect(item('wrist-wraps').coinGoal).toBe(1592);
    // Part coins: the 30% share of ₹449.
    expect(item('cap').coinGoal).toBe(538);
    // Money only: nothing to save up for.
    expect(item('foam-roller').coinGoal).toBe(0);
    // ₹1,499 ships free, so a part-coins hoodie is its share alone.
    expect(item('hoodie').coinGoal).toBe(item('hoodie').coinsMax);
  });

  test('counts whole coins against the goal, and is reached only when every coin is there', () => {
    expect(coinGoalOf(1592, 1591.9, 'redeem')).toEqual({
      kind: 'redeem',
      goal: 1592,
      have: 1591,
      short: 1,
      progress: 1591 / 1592,
      reached: false,
    });
    expect(coinGoalOf(1592, 1592, 'redeem')).toMatchObject({
      short: 0,
      progress: 1,
      reached: true,
    });
    // More than enough still reads as a full bar, not 150%.
    expect(coinGoalOf(1592, 4000, 'redeem')).toMatchObject({
      have: 4000,
      progress: 1,
      reached: true,
    });
  });

  test('draws no goal for an item coins cannot go towards', () => {
    expect(itemCoinGoal(item('foam-roller'), 10_000)).toBeNull();
    expect(itemCoinGoal({ ...item('cap'), coinGoal: 0 }, 10_000)).toBeNull();
  });

  test('names the goal by how the item is bought', () => {
    expect(itemCoinGoal(item('wrist-wraps'), 0)?.kind).toBe('redeem');
    expect(itemCoinGoal(item('cap'), 0)?.kind).toBe('discount');
    // A fixed share: the coins must be paid.
    expect(itemCoinGoal({ ...item('cap'), coinsMin: 359 }, 0)?.kind).toBe(
      'share',
    );
  });

  test('says where it stands in words, and never "ready" over a sold-out item', () => {
    const wraps = itemCoinGoal(item('wrist-wraps'), 1000)!;
    expect(itemGoalStatus(wraps)).toEqual({
      long: '592 more coins to redeem',
      short: '592 to go',
      tone: 'progress',
    });
    const ready = itemCoinGoal(item('wrist-wraps'), 2000)!;
    expect(itemGoalStatus(ready).short).toBe('Ready to redeem');
    expect(itemGoalStatus(ready, false)).toMatchObject({
      short: 'Sold out',
      tone: 'muted',
    });
    const cap = itemCoinGoal(item('cap'), 100)!;
    expect(itemGoalStatus(cap).long).toBe(
      '438 more coins for the full coin discount',
    );
    expect(itemGoalStatus(itemCoinGoal(item('cap'), 600)!).long).toBe(
      'Full coin discount unlocked',
    );
  });

  test('an order reads as "to check out"', () => {
    expect(orderGoalStatus(coinGoalOf(1992, 1500, 'redeem')).long).toBe(
      '492 more coins to check out',
    );
    expect(orderGoalStatus(coinGoalOf(1992, 1992, 'redeem')).long).toBe(
      'You have enough coins for this order',
    );
  });
});

describe('the order goals are shown in', () => {
  test('what can be redeemed now first, then the nearest, sold-out last, money-only never', () => {
    const items = [
      item('foam-roller'), // money only
      { ...item('jump-rope'), inStock: false }, // 1,392, sold out
      item('cap'), // 538, a discount
      item('wrist-wraps'), // 1,592
      item('socks'), // 1,392
    ];
    const ranked = rankCoinGoals(items, 1400);
    expect(ranked.map(entry => entry.item.id)).toEqual([
      'cap', // reached
      'socks', // reached
      'wrist-wraps', // 1,400 / 1,592
      'jump-rope', // sold out, though the coins are there
    ]);
    // The cap's coins were only ever a discount: not "ready to redeem".
    expect(countReady(ranked)).toBe(1);
  });

  test('ties keep the wishlist order, newest save first', () => {
    const ranked = rankCoinGoals([item('jump-rope'), item('socks')], 0);
    expect(ranked.map(entry => entry.item.id)).toEqual(['jump-rope', 'socks']);
  });
});

describe('the Saving For card', () => {
  let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

  afterEach(async () => {
    const tree = mounted;
    mounted = null;
    if (tree) {
      await ReactTestRenderer.act(() => tree.unmount());
    }
  });

  const render = async (props: React.ComponentProps<typeof WishlistGoalsCard>) => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <WishlistGoalsCard {...props} />
        </ThemeProvider>,
      );
    });
    mounted = tree;
    return tree;
  };

  const noop = () => {};

  test('draws nothing when nothing saved takes coins', async () => {
    for (const items of [null, [], [item('foam-roller')]]) {
      const tree = await render({
        items,
        balance: 5000,
        onPressItem: noop,
        onPressViewAll: noop,
      });
      expect(tree.toJSON()).toBeNull();
    }
  });

  test('leads with how far the nearest reward is, and opens the product from its row', async () => {
    const onPressItem = jest.fn();
    const tree = await render({
      items: [item('wrist-wraps'), item('socks')],
      balance: 1000,
      onPressItem,
      onPressViewAll: noop,
    });
    const text = textOf(tree, RNText);
    expect(text).toContain('Saving For');
    // Socks are 1,392: the nearer of the two.
    expect(text).toContain('392 coins to your next reward');
    expect(text).toContain('1,000 / 1,392');
    expect(text).toContain('592 to go');

    const row = tree.root.find(
      node =>
        typeof node.props.onPress === 'function' &&
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.startsWith('Wrist Wraps.'),
    );
    expect(row.props.accessibilityLabel).toBe(
      'Wrist Wraps. 1,000 of 1,592 coins. 592 more coins to redeem.',
    );
    await ReactTestRenderer.act(() => row.props.onPress());
    expect(onPressItem).toHaveBeenCalledWith('wrist-wraps');
  });

  test('says how many are ready, and keeps to its limit', async () => {
    const tree = await render({
      items: [item('wrist-wraps'), item('socks'), item('jump-rope')],
      balance: 1500,
      limit: 2,
      onPressItem: noop,
      onPressViewAll: noop,
    });
    const text = textOf(tree, RNText);
    expect(text).toContain('2 rewards are ready to redeem');
    // The wrapper and the view it draws both carry the label: count labels.
    const rows = new Set(
      tree.root
        .findAll(
          node =>
            typeof node.props.onPress === 'function' &&
            node.props.accessibilityHint === 'Opens the product',
        )
        .map(node => node.props.accessibilityLabel),
    );
    expect(rows.size).toBe(2);
  });
});

describe('the saved items behind the bars', () => {
  beforeEach(() => {
    useWishlistStore.getState().reset();
    wishlistApi.list.mockReset();
    wishlistApi.ids.mockReset();
  });

  test('asks for nothing when nothing is saved', async () => {
    await useWishlistStore.getState().refreshItemsIfStale();
    expect(wishlistApi.list).not.toHaveBeenCalled();
  });

  test('fetches the items for saved ids, then trusts them for a while', async () => {
    wishlistApi.list.mockResolvedValue([item('socks')]);
    useWishlistStore.setState({ ids: ['socks'] });

    await useWishlistStore.getState().refreshItemsIfStale();
    expect(wishlistApi.list).toHaveBeenCalledTimes(1);
    expect(useWishlistStore.getState().items?.map(i => i.id)).toEqual([
      'socks',
    ]);

    await useWishlistStore.getState().refreshItemsIfStale();
    expect(wishlistApi.list).toHaveBeenCalledTimes(1);
  });

  test('asks again once the saved ids and the items part ways', async () => {
    wishlistApi.list.mockResolvedValue([item('socks'), item('cap')]);
    useWishlistStore.setState({
      ids: ['cap', 'socks'],
      items: [item('socks')],
      // Past the short retry, well inside the staleness window.
      itemsSyncedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await useWishlistStore.getState().refreshItemsIfStale();
    expect(wishlistApi.list).toHaveBeenCalledTimes(1);
  });

  test('a stored list from an older build is read back with the goal defaulted', async () => {
    const { coinGoal: _dropped, ...older } = item('socks');
    mmkvStorage.setItem(
      'vokve.wishlist',
      JSON.stringify({
        state: {
          ids: ['socks', 'broken'],
          syncedAt: new Date().toISOString(),
          items: [older, { id: 'broken' }],
          itemsSyncedAt: new Date().toISOString(),
        },
        version: 1,
      }),
    );
    await useWishlistStore.persist.rehydrate();
    const { items } = useWishlistStore.getState();
    expect(items?.map(i => i.id)).toEqual(['socks']);
    expect(items?.[0].coinGoal).toBe(0);
  });
});
