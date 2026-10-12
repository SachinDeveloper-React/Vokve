/**
 * The food library hook is the browse screen's paging, so the checks here are
 * the contract that screen relies on: the first page replaces, the next
 * appends under the server's cursor, the end is known rather than guessed at,
 * a new term starts over and drops what the old one still had in flight, and
 * a failure parks the end-reached hook until an explicit retry.
 *
 * @format
 */

import React, { useEffect } from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  FOOD_PAGE_SIZE,
  useFoodLibrary,
  type FoodLibrary,
} from '../src/hooks/useFoodLibrary';
import { foodLibrary as seedFoods } from '../src/constants/seedData';
import type { FoodItem } from '../src/types/models';

jest.mock('../src/services/api/endpoints', () => ({
  nutritionApi: { foodLibrary: jest.fn() },
}));

const { nutritionApi } = jest.requireMock('../src/services/api/endpoints') as {
  nutritionApi: { foodLibrary: jest.Mock };
};

const page = (
  data: FoodItem[],
  nextCursor: string | null = null,
  total = data.length,
) => ({ data, nextCursor, total });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const ids = (items: FoodItem[]) => items.map(item => item.id);

/** Renders the hook and hands back its latest value through a ref-like box. */
const Probe = ({
  query,
  out,
}: {
  query: string;
  out: { current: FoodLibrary | null };
}) => {
  const library = useFoodLibrary(query);
  useEffect(() => {
    out.current = library;
  });
  return null;
};

const settle = () =>
  ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

const mount = async (query: string) => {
  const out: { current: FoodLibrary | null } = { current: null };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Probe query={query} out={out} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  mounted = tree;
  await settle();
  const update = async (next: string) => {
    await ReactTestRenderer.act(async () => {
      tree.update(<Probe query={next} out={out} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
  };
  const value = () => {
    if (!out.current) throw new Error('Hook has not rendered');
    return out.current;
  };
  return { value, update };
};

beforeEach(() => {
  nutritionApi.foodLibrary.mockReset().mockResolvedValue(page([]));
});

afterEach(async () => {
  const tree = mounted;
  mounted = null;
  if (tree) {
    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  }
});

test('asks for the first page with no cursor, and reports the library’s total', async () => {
  nutritionApi.foodLibrary.mockResolvedValue(
    page(seedFoods.slice(0, 4), 'offset:4', seedFoods.length),
  );
  const { value } = await mount('');

  expect(nutritionApi.foodLibrary).toHaveBeenCalledWith({
    q: undefined,
    cursor: undefined,
    limit: FOOD_PAGE_SIZE,
  });
  expect(ids(value().items)).toEqual(ids(seedFoods.slice(0, 4)));
  // The total is the library's, not the page's — what "15 foods" on the
  // screen is counting.
  expect(value().total).toBe(seedFoods.length);
  expect(value().hasMore).toBe(true);
  expect(value().isLoading).toBe(false);
});

test('a term is sent as it is typed, trimmed', async () => {
  await mount('  banana  ');

  expect(nutritionApi.foodLibrary).toHaveBeenCalledWith({
    q: 'banana',
    cursor: undefined,
    limit: FOOD_PAGE_SIZE,
  });
});

test('loadMore appends the next page under the server’s cursor', async () => {
  nutritionApi.foodLibrary
    .mockResolvedValueOnce(page(seedFoods.slice(0, 2), 'offset:2', 4))
    .mockResolvedValueOnce(page(seedFoods.slice(2, 4), null, 4));
  const { value } = await mount('');

  await ReactTestRenderer.act(async () => {
    value().loadMore();
  });
  await settle();

  expect(nutritionApi.foodLibrary).toHaveBeenLastCalledWith({
    q: undefined,
    cursor: 'offset:2',
    limit: FOOD_PAGE_SIZE,
  });
  // The first page is kept and the second is added under it, in order.
  expect(ids(value().items)).toEqual(ids(seedFoods.slice(0, 4)));
  expect(value().hasMore).toBe(false);
});

test('with no cursor left, loadMore asks for nothing', async () => {
  nutritionApi.foodLibrary.mockResolvedValue(page(seedFoods.slice(0, 2)));
  const { value } = await mount('');
  expect(value().hasMore).toBe(false);

  await ReactTestRenderer.act(async () => {
    value().loadMore();
    value().loadMore();
  });
  await settle();

  expect(nutritionApi.foodLibrary).toHaveBeenCalledTimes(1);
  expect(ids(value().items)).toEqual(ids(seedFoods.slice(0, 2)));
});

test('a new term starts a fresh list, and the old one’s answer is dropped', async () => {
  const slow = deferred<ReturnType<typeof page>>();
  nutritionApi.foodLibrary
    .mockReturnValueOnce(slow.promise)
    .mockResolvedValueOnce(page(seedFoods.slice(5, 6), null, 1));

  const { value, update } = await mount('ban');
  await update('banana');

  // The "ban" page lands late: it belongs to a question the user has typed
  // past, so it is not shown.
  await ReactTestRenderer.act(async () => {
    slow.resolve(page(seedFoods.slice(0, 4), 'offset:4', 15));
    await Promise.resolve();
  });
  await settle();

  expect(ids(value().items)).toEqual(ids(seedFoods.slice(5, 6)));
  expect(value().total).toBe(1);
  expect(value().hasMore).toBe(false);
});

test('a failed page parks the paging until retry asks again', async () => {
  nutritionApi.foodLibrary
    .mockResolvedValueOnce(page(seedFoods.slice(0, 2), 'offset:2', 4))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(page(seedFoods.slice(2, 4), null, 4));
  const { value } = await mount('');

  await ReactTestRenderer.act(async () => {
    value().loadMore();
  });
  await settle();
  expect(value().error).not.toBeNull();
  // What arrived stays on screen; only the page that failed is missing.
  expect(ids(value().items)).toEqual(ids(seedFoods.slice(0, 2)));

  // The list re-measuring its footer must not hammer a dead network.
  await ReactTestRenderer.act(async () => {
    value().loadMore();
    value().loadMore();
  });
  await settle();
  expect(nutritionApi.foodLibrary).toHaveBeenCalledTimes(2);

  await ReactTestRenderer.act(async () => {
    value().retry();
  });
  await settle();

  expect(nutritionApi.foodLibrary).toHaveBeenCalledTimes(3);
  expect(value().error).toBeNull();
  expect(ids(value().items)).toEqual(ids(seedFoods.slice(0, 4)));
});

test('a first page that failed is retried as a first page, not a next one', async () => {
  nutritionApi.foodLibrary
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(page(seedFoods.slice(0, 2), null, 2));
  const { value } = await mount('');

  expect(value().error).not.toBeNull();
  expect(value().items).toEqual([]);

  await ReactTestRenderer.act(async () => {
    value().retry();
  });
  await settle();

  expect(nutritionApi.foodLibrary).toHaveBeenLastCalledWith({
    q: undefined,
    cursor: undefined,
    limit: FOOD_PAGE_SIZE,
  });
  expect(ids(value().items)).toEqual(ids(seedFoods.slice(0, 2)));
});
