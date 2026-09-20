/**
 * Recent searches are a list the search screen offers back, so the checks
 * here are about what makes it into the list: the newest first, a repeat
 * moving up rather than doubling (whatever its case), a cap so the list
 * stays a list, and nothing too short to have been a search at all.
 *
 * @format
 */

import { useShopSearchStore } from '../src/stores/shopSearchStore';

beforeEach(() => {
  useShopSearchStore.getState().clear();
});

test('remembers searches newest first', () => {
  const { remember } = useShopSearchStore.getState();
  remember('rope');
  remember('mat');
  expect(useShopSearchStore.getState().recent).toEqual(['mat', 'rope']);
});

test('a repeat moves to the front instead of appearing twice, whatever its case', () => {
  const { remember } = useShopSearchStore.getState();
  remember('rope');
  remember('mat');
  remember('  Rope ');
  expect(useShopSearchStore.getState().recent).toEqual(['Rope', 'mat']);
});

test('keeps the eight most recent', () => {
  const { remember } = useShopSearchStore.getState();
  for (const term of ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9']) {
    remember(term);
  }
  const { recent } = useShopSearchStore.getState();
  expect(recent).toHaveLength(8);
  expect(recent[0]).toBe('t9');
  expect(recent).not.toContain('t1');
});

test('ignores anything shorter than a search', () => {
  const { remember } = useShopSearchStore.getState();
  remember('r');
  remember('   ');
  expect(useShopSearchStore.getState().recent).toEqual([]);
});

test('forgets one term and can clear them all', () => {
  const { remember, forget, clear } = useShopSearchStore.getState();
  remember('rope');
  remember('mat');
  forget('rope');
  expect(useShopSearchStore.getState().recent).toEqual(['mat']);
  clear();
  expect(useShopSearchStore.getState().recent).toEqual([]);
});
