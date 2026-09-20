/**
 * The catalogue hook is the shop's paging, shared by every list that
 * browses or searches, so the checks here are about the contract those
 * lists rely on: the first page replaces, the next appends, a changed query
 * starts over and drops what the old query still had in flight, a page-2
 * request carries the query as it is now, a failure parks the end-reached
 * hook until an explicit retry, and disabled means silent.
 *
 * @format
 */

import React, { useEffect } from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  CATALOGUE_PAGE_SIZE,
  useCatalogue,
  type Catalogue,
} from '../src/hooks/useCatalogue';
import type { ShopItemsQuery } from '../src/services/api/contracts';
import { shopItems } from '../src/constants/seedData';
import type { ShopItem } from '../src/types/models';

jest.mock('../src/services/api/endpoints', () => ({
  shopApi: { items: jest.fn() },
}));

const { shopApi } = jest.requireMock('../src/services/api/endpoints') as {
  shopApi: { items: jest.Mock };
};

const page = (
  data: ShopItem[],
  nextCursor: string | null = null,
  total = data.length,
) => ({
  data,
  nextCursor,
  total,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const gym = shopItems.filter(i => i.category === 'gym');
const clothing = shopItems.filter(i => i.category === 'clothing');

/** Renders the hook and hands back its latest value through a ref-like box. */
const Probe = ({
  query,
  enabled,
  out,
}: {
  query: ShopItemsQuery;
  enabled?: boolean;
  out: { current: Catalogue | null };
}) => {
  const catalogue = useCatalogue(query, enabled);
  useEffect(() => {
    out.current = catalogue;
  });
  return null;
};

const settle = () =>
  ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

const mount = async (query: ShopItemsQuery, enabled?: boolean) => {
  const out: { current: Catalogue | null } = { current: null };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <Probe query={query} enabled={enabled} out={out} />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  mounted = tree;
  await settle();
  const update = async (next: ShopItemsQuery, nextEnabled?: boolean) => {
    await ReactTestRenderer.act(async () => {
      tree.update(<Probe query={next} enabled={nextEnabled} out={out} />);
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
  shopApi.items.mockReset().mockResolvedValue(page([]));
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

test('asks for the first page with the query and the page size, and reports the total', async () => {
  shopApi.items.mockResolvedValue(
    page(gym.slice(0, 3), 'offset:3', gym.length),
  );
  const { value } = await mount({ category: 'gym', sort: 'popular' });

  expect(shopApi.items).toHaveBeenCalledWith({
    category: 'gym',
    sort: 'popular',
    cursor: undefined,
    limit: CATALOGUE_PAGE_SIZE,
  });
  expect(value().items.map(i => i.id)).toEqual(gym.slice(0, 3).map(i => i.id));
  expect(value().total).toBe(gym.length);
  expect(value().hasMore).toBe(true);
  expect(value().isLoading).toBe(false);
});

test('loadMore appends the next page under the cursor; without one it does nothing', async () => {
  shopApi.items
    .mockResolvedValueOnce(page(gym.slice(0, 2), 'offset:2', 4))
    .mockResolvedValueOnce(page(gym.slice(2, 4), null, 4));
  const { value } = await mount({ category: 'gym' });

  await ReactTestRenderer.act(async () => {
    value().loadMore();
  });
  await settle();

  expect(shopApi.items).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: 'offset:2' }),
  );
  expect(value().items.map(i => i.id)).toEqual(gym.slice(0, 4).map(i => i.id));
  expect(value().hasMore).toBe(false);

  await ReactTestRenderer.act(async () => {
    value().loadMore();
  });
  await settle();
  expect(shopApi.items).toHaveBeenCalledTimes(2);
});

test("a changed query starts a fresh list and drops the old query's late answer", async () => {
  const slow = deferred<ReturnType<typeof page>>();
  shopApi.items
    .mockReturnValueOnce(slow.promise)
    .mockResolvedValueOnce(page(clothing.slice(0, 2)));
  const { value, update } = await mount({ category: 'gym' });
  expect(value().isLoading).toBe(true);

  await update({ category: 'clothing' });
  expect(value().items.map(i => i.id)).toEqual(
    clothing.slice(0, 2).map(i => i.id),
  );

  await ReactTestRenderer.act(async () => {
    slow.resolve(page(gym.slice(0, 2)));
  });
  await settle();
  expect(value().items.map(i => i.id)).toEqual(
    clothing.slice(0, 2).map(i => i.id),
  );
  expect(value().isLoading).toBe(false);
});

test('a page-2 request carries the query as it is now, not as it was when the page was built', async () => {
  shopApi.items
    .mockResolvedValueOnce(page(gym.slice(0, 2), 'offset:2', 4))
    .mockResolvedValueOnce(page(gym.slice(0, 2), 'offset:2', 4))
    .mockResolvedValueOnce(page(gym.slice(2, 4), null, 4));
  const { value, update } = await mount({ category: 'gym', sort: 'popular' });

  // The re-render with a new sort key restarts the list, so page 2 is then
  // asked for under the new sort — never the old one.
  await update({ category: 'gym', sort: 'price_asc' });
  await ReactTestRenderer.act(async () => {
    value().loadMore();
  });
  await settle();

  expect(shopApi.items).toHaveBeenLastCalledWith(
    expect.objectContaining({ sort: 'price_asc', cursor: 'offset:2' }),
  );
});

test('after a failed page, loadMore is inert and retry asks for the same page again', async () => {
  shopApi.items
    .mockResolvedValueOnce(page(gym.slice(0, 2), 'offset:2', 4))
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce(page(gym.slice(2, 4), null, 4));
  const { value } = await mount({ category: 'gym' });

  await ReactTestRenderer.act(async () => {
    value().loadMore();
  });
  await settle();
  expect(value().error).not.toBeNull();
  expect(value().items).toHaveLength(2);

  await ReactTestRenderer.act(async () => {
    value().loadMore();
  });
  await settle();
  expect(shopApi.items).toHaveBeenCalledTimes(2);

  await ReactTestRenderer.act(async () => {
    value().retry();
  });
  await settle();
  expect(shopApi.items).toHaveBeenCalledTimes(3);
  expect(shopApi.items).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: 'offset:2' }),
  );
  expect(value().error).toBeNull();
  expect(value().items).toHaveLength(4);
});

test('a failed first page retries from the top', async () => {
  shopApi.items
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce(page(gym.slice(0, 1)));
  const { value } = await mount({ category: 'gym' });
  expect(value().error).not.toBeNull();
  expect(value().items).toEqual([]);

  await ReactTestRenderer.act(async () => {
    value().retry();
  });
  await settle();
  expect(shopApi.items).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: undefined }),
  );
  expect(value().items).toHaveLength(1);
});

test('refresh keeps the rows on screen while the fresh first page arrives, then replaces them', async () => {
  const fresh = deferred<ReturnType<typeof page>>();
  shopApi.items
    .mockResolvedValueOnce(page(gym.slice(0, 2), 'offset:2', 4))
    .mockResolvedValueOnce(page(gym.slice(2, 4), null, 4))
    .mockReturnValueOnce(fresh.promise);
  const { value } = await mount({ category: 'gym' });
  await ReactTestRenderer.act(async () => {
    value().loadMore();
  });
  await settle();
  expect(value().items).toHaveLength(4);

  await ReactTestRenderer.act(async () => {
    value().refresh();
  });
  expect(value().isRefreshing).toBe(true);
  expect(value().isLoading).toBe(false);
  expect(value().items).toHaveLength(4);

  await ReactTestRenderer.act(async () => {
    fresh.resolve(page(gym.slice(4, 5), null, 1));
  });
  await settle();
  expect(value().isRefreshing).toBe(false);
  expect(value().items.map(i => i.id)).toEqual([gym[4].id]);
  expect(value().total).toBe(1);
});

test('disabled, it holds an empty list and asks for nothing until enabled', async () => {
  shopApi.items.mockResolvedValue(page(gym.slice(0, 1)));
  const { value, update } = await mount({ q: 'ma' }, false);
  expect(shopApi.items).not.toHaveBeenCalled();
  expect(value().items).toEqual([]);
  expect(value().isLoading).toBe(false);

  await update({ q: 'mat' }, true);
  expect(shopApi.items).toHaveBeenCalledWith(
    expect.objectContaining({ q: 'mat' }),
  );
  expect(value().items).toHaveLength(1);
});
