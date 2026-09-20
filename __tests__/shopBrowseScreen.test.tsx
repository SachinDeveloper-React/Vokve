/**
 * The browse and search screens are the shop's long lists, paged from the
 * server, so the checks here are about the query they send and how they
 * treat its answer: a category page asks for that shelf and pages it, a
 * sort or a subcategory chip starts a fresh list, "In stock only" travels
 * as a filter rather than being applied on the device, a search waits for
 * the typing to stop and drops an answer to a query the user has left, and
 * an item on either opens the same checkout the shop uses.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { ShopBrowseScreen } from '../src/screens/main/ShopBrowseScreen';
import { ShopSearchScreen } from '../src/screens/main/ShopSearchScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { CATALOGUE_PAGE_SIZE } from '../src/hooks/useCatalogue';
import { useAuthStore } from '../src/stores/authStore';
import { useShopSearchStore } from '../src/stores/shopSearchStore';
import { useShopStore } from '../src/stores/shopStore';
import { shopItems } from '../src/constants/seedData';
import type { ShopItem } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: Record<string, unknown> | undefined;

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
    addListener: jest.fn(() => jest.fn()),
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../src/services/api/endpoints', () => ({
  shopApi: {
    items: jest.fn(),
    item: jest.fn(),
    categories: jest.fn(),
    config: jest.fn(),
  },
  cartApi: {
    get: jest.fn(),
    setLine: jest.fn(),
    removeLine: jest.fn(),
    clear: jest.fn(),
  },
  wishlistApi: {
    list: jest.fn(),
    ids: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
  },
  checkoutApi: { quote: jest.fn(), place: jest.fn(), pay: jest.fn() },
  orderApi: {
    list: jest.fn(),
    get: jest.fn(),
    count: jest.fn(),
    cancel: jest.fn(),
  },
  addressApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setDefault: jest.fn(),
    remove: jest.fn(),
  },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
  notificationApi: {
    list: jest.fn(),
    counts: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
  authApi: { stepUp: jest.fn(), signOut: jest.fn() },
}));

const { shopApi } = jest.requireMock('../src/services/api/endpoints') as {
  shopApi: { items: jest.Mock };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
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

const gym = shopItems.filter(i => i.category === 'gym');

/** Lets a test hold a response back until it decides the order of arrival. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  jest.useRealTimers();
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockRouteParams = undefined;
  shopApi.items.mockReset().mockResolvedValue(page([]));
  useShopStore.getState().reset();
  useShopSearchStore.getState().clear();
  useAuthStore.setState({
    status: 'authenticated',
    stepUpToken: null,
    pendingVerification: null,
  });
});

afterEach(async () => {
  const tree = mounted;
  mounted = null;
  if (tree) {
    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  }
  jest.useRealTimers();
});

/** Lets every promise queued so far settle, so a mocked page can land. */
const settle = () =>
  ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

// Mounting is an async act: the browse screen asks for its first page from
// an effect, and a mock that answers at once would otherwise land between
// the mount and the first settle, outside any act.
const render = async (screen: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>{screen}</ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  mounted = tree;
  await settle();
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
};

const list = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll(n => typeof n.props?.onEndReached === 'function')[0];

describe('ShopBrowseScreen', () => {
  test('a category page asks the server for that shelf, popular first, and names it', async () => {
    mockRouteParams = { category: 'gym' };
    shopApi.items.mockResolvedValue(page(gym, null, gym.length));

    const tree = await render(<ShopBrowseScreen />);

    expect(shopApi.items).toHaveBeenCalledWith({
      category: 'gym',
      deals: undefined,
      subcategory: undefined,
      sort: 'popular',
      inStock: undefined,
      cursor: undefined,
      limit: CATALOGUE_PAGE_SIZE,
    });
    const text = allText(tree);
    expect(text).toContain('Gym');
    expect(text).toContain(`${gym.length} rewards`);
    expect(text).toContain('Yoga Mat');
  });

  test('the deals page and the whole catalogue are the same screen, differently narrowed', async () => {
    mockRouteParams = { deals: true };
    await render(<ShopBrowseScreen />);
    expect(shopApi.items).toHaveBeenLastCalledWith(
      expect.objectContaining({ deals: true, category: undefined }),
    );
    expect(allText(mounted!)).toContain("Today's deals");

    await ReactTestRenderer.act(() => {
      mounted!.unmount();
    });
    mounted = null;
    mockRouteParams = { title: 'All rewards' };
    const all = await render(<ShopBrowseScreen />);
    expect(shopApi.items).toHaveBeenLastCalledWith(
      expect.objectContaining({ deals: undefined, category: undefined }),
    );
    expect(allText(all)).toContain('All rewards');
  });

  test('a subcategory chip, a sort and "In stock only" each start a fresh list with the new query', async () => {
    mockRouteParams = { category: 'gym' };
    useShopStore.setState({
      categories: [
        {
          category: 'gym',
          count: 8,
          inStock: 8,
          subcategories: [
            { name: 'Support', count: 3 },
            { name: 'Mats', count: 1 },
          ],
        },
      ],
    });
    shopApi.items.mockResolvedValue(page(gym));
    const tree = await render(<ShopBrowseScreen />);

    await press(tree, 'Support, 3');
    expect(shopApi.items).toHaveBeenLastCalledWith(
      expect.objectContaining({ subcategory: 'Support' }),
    );

    await press(tree, 'Sort by, Popular');
    await press(tree, 'Price: low to high');
    expect(shopApi.items).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'price_asc', subcategory: 'Support' }),
    );

    await press(tree, 'In stock only');
    expect(shopApi.items).toHaveBeenLastCalledWith(
      expect.objectContaining({ inStock: true }),
    );
    expect(allText(tree)).toContain('in stock');
  });

  test('reaching the end fetches the next page with the cursor and appends it', async () => {
    mockRouteParams = { category: 'gym' };
    shopApi.items
      .mockResolvedValueOnce(page(gym.slice(0, 2), 'offset:2', gym.length))
      .mockResolvedValueOnce(page(gym.slice(2, 4), null, gym.length));
    const tree = await render(<ShopBrowseScreen />);

    await ReactTestRenderer.act(async () => {
      list(tree).props.onEndReached();
    });
    await settle();

    expect(shopApi.items).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'offset:2', category: 'gym' }),
    );
    const text = allText(tree);
    expect(text).toContain(gym[0].title);
    expect(text).toContain(gym[3].title);
  });

  test('a failed page stops the end-reached hook and offers a retry; an empty shelf says so', async () => {
    mockRouteParams = { category: 'sports' };
    shopApi.items
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce(page([]));
    const tree = await render(<ShopBrowseScreen />);

    expect(allText(tree)).toContain("Couldn't load the shop");
    const retry = tree.root
      .findAll(n => n.props?.label === 'Try again')
      .find(n => typeof n.props.onPress === 'function');
    if (!retry) throw new Error('No retry');
    await ReactTestRenderer.act(async () => {
      retry.props.onPress();
    });
    await settle();
    expect(shopApi.items).toHaveBeenCalledTimes(2);
    expect(allText(tree)).toContain('Nothing here right now');
  });

  test("a card opens the item's page; the filter sheet narrows the query by price, rating and deals", async () => {
    mockRouteParams = { category: 'gym' };
    shopApi.items.mockResolvedValue(page(gym));
    const tree = await render(<ShopBrowseScreen />);

    await press(tree, 'Yoga Mat, view details');
    expect(mockNavigate).toHaveBeenCalledWith('ProductDetail', {
      id: 'yoga-mat',
    });

    await press(tree, 'Filters');
    await press(tree, '₹300 – ₹600');
    await press(tree, '4★ & up');
    const apply = tree.root
      .findAll(
        n =>
          n.props?.label === 'Show results' &&
          typeof n.props.onPress === 'function',
      )
      .at(-1);
    if (!apply) throw new Error('No apply');
    await ReactTestRenderer.act(async () => {
      apply.props.onPress();
    });
    await settle();

    expect(shopApi.items).toHaveBeenLastCalledWith(
      expect.objectContaining({
        minPrice: 30000,
        maxPrice: 59999,
        minRating: 4,
        category: 'gym',
      }),
    );
    expect(
      tree.root.findAll(
        n => n.props?.accessibilityLabel === 'Filters, 2 applied',
      ).length,
    ).toBeGreaterThan(0);

    // "Top rated" is a sort of its own.
    await press(tree, 'Sort by, Popular');
    await press(tree, 'Top rated');
    expect(shopApi.items).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'rating' }),
    );
  });
});

describe('ShopSearchScreen', () => {
  const type = async (
    tree: ReactTestRenderer.ReactTestRenderer,
    value: string,
  ) => {
    const input = tree.root
      .findAll(
        n =>
          n.props?.accessibilityLabel === 'Search the shop' &&
          typeof n.props.onChangeText === 'function',
      )
      .at(-1);
    if (!input) throw new Error('No search field');
    await ReactTestRenderer.act(async () => {
      input.props.onChangeText(value);
    });
  };

  test('asks nothing until two letters are typed and the typing stops, then searches', async () => {
    jest.useFakeTimers();
    const tree = await render(<ShopSearchScreen />);
    expect(shopApi.items).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('What are you after?');

    await type(tree, 'r');
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(shopApi.items).not.toHaveBeenCalled();

    shopApi.items.mockResolvedValue(
      page(
        shopItems.filter(i => i.tags.includes('racket')),
        null,
        1,
      ),
    );
    await type(tree, 'ra');
    await type(tree, 'rac');
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(400);
    });
    await settle();

    // One request, for the settled text — not one per keystroke.
    expect(shopApi.items).toHaveBeenCalledTimes(1);
    expect(shopApi.items).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'rac', category: undefined }),
    );
    const text = allText(tree);
    expect(text).toContain('1 result for "rac"');
    expect(text).toContain('Badminton Racket Set');
  });

  test('a category chip narrows the same search, and a search that ran is remembered', async () => {
    jest.useFakeTimers();
    shopApi.items.mockResolvedValue(page([], null, 0));
    const tree = await render(<ShopSearchScreen />);

    await type(tree, 'ball');
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(400);
    });
    await settle();
    expect(useShopSearchStore.getState().recent).toEqual(['ball']);

    await press(tree, 'Sports');
    expect(shopApi.items).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'ball', category: 'sports' }),
    );
    expect(allText(tree)).toContain('Nothing for "ball"');
    expect(allText(tree)).toContain('Try clearing the category');
  });

  test('an answer for a query the user has already left is thrown away', async () => {
    jest.useFakeTimers();
    const slow = deferred<ReturnType<typeof page>>();
    shopApi.items.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(
      page(
        shopItems.filter(i => i.id === 'shorts'),
        null,
        1,
      ),
    );
    const tree = await render(<ShopSearchScreen />);

    await type(tree, 'sho');
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(400);
    });
    await type(tree, 'shorts');
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(400);
    });
    await settle();
    expect(allText(tree)).toContain('Training Shorts');

    await ReactTestRenderer.act(async () => {
      slow.resolve(
        page(
          shopItems.filter(i => i.id === 'shaker'),
          null,
          1,
        ),
      );
    });
    await settle();
    expect(allText(tree)).not.toContain('Protein Shaker');
  });

  test('recent searches are offered back, run again on a tap, and can be forgotten', async () => {
    useShopSearchStore.setState({ recent: ['rope', 'mat'] });
    const tree = await render(<ShopSearchScreen />);

    const text = allText(tree);
    expect(text).toContain('Recent searches');
    expect(text).toContain('rope');

    await press(tree, 'Forget mat');
    expect(useShopSearchStore.getState().recent).toEqual(['rope']);

    jest.useFakeTimers();
    shopApi.items.mockResolvedValue(
      page(
        shopItems.filter(i => i.id === 'jump-rope'),
        null,
        1,
      ),
    );
    await press(tree, 'Search again for rope');
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(400);
    });
    await settle();
    expect(shopApi.items).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'rope' }),
    );
    expect(allText(tree)).toContain('Speed Rope');
  });

  test('the chevron goes back', async () => {
    await press(await render(<ShopSearchScreen />), 'Back');
    expect(mockGoBack).toHaveBeenCalled();
  });
});
