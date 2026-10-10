/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf as collectText } from './helpers/text';
import { waterDay } from './helpers/hydration';
import { HydrationCard } from '../src/components/fitness/HydrationCard';
import { MotivationCard } from '../src/components/home/MotivationCard';
import { MOTIVATION_EMOJIS } from '../src/components/home/MotivationArt';
import { QuickActionsRow } from '../src/components/home/QuickActionsRow';
import { ApiError } from '../src/services/api/errors';
import {
  useHydrationStore,
  useTodayHydrationView,
} from '../src/stores/hydrationStore';
import { ThemeProvider } from '../src/theme';
import { todayIso } from '../src/utils/date';

jest.mock('../src/services/api/endpoints', () => ({
  hydrationApi: { today: jest.fn(), log: jest.fn(), remove: jest.fn() },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
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
  collectText(tree, Text);

const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');

describe('hydration store', () => {
  const { hydrationApi } = jest.requireMock('../src/services/api/endpoints') as {
    hydrationApi: { today: jest.Mock; log: jest.Mock; remove: jest.Mock };
  };

  // The server's day, limits and all (RULES Y1b).
  const day = waterDay;

  /** Lets the background flush run. */
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  /** Reads the view hook once, the way a screen would. */
  const readView = async () => {
    let view!: ReturnType<typeof useTodayHydrationView>;
    const Probe = () => {
      view = useTodayHydrationView();
      return null;
    };
    await render(<Probe />);
    return view;
  };

  beforeEach(() => {
    useHydrationStore.getState().reset();
    hydrationApi.today.mockReset();
    hydrationApi.log.mockReset();
    hydrationApi.remove.mockReset();
  });

  test('a new store has no day until the server answers', async () => {
    const view = await readView();
    expect(view).toEqual({ synced: false, consumedMl: 0, entries: [] });
  });

  test("a drink shows at once, is sent under its own id, and the server's day replaces the cache", async () => {
    hydrationApi.log.mockImplementation(async (entry: { id: string; ml: number; at: string }) =>
      day([entry]),
    );

    useHydrationStore.getState().add(250);
    const pending = useHydrationStore.getState().outbox;
    expect(pending).toHaveLength(1);
    expect((await readView()).consumedMl).toBe(250);

    await settle();
    const sent = (pending[0] as { entry: { id: string } }).entry;
    expect(hydrationApi.log).toHaveBeenCalledWith(
      expect.objectContaining({ id: sent.id, ml: 250 }),
      { idempotencyKey: `drink:${sent.id}` },
    );
    expect(useHydrationStore.getState().outbox).toEqual([]);
    expect(useHydrationStore.getState().day?.consumedMl).toBe(250);
    expect(await readView()).toMatchObject({ synced: true, consumedMl: 250 });
  });

  test('a drink that cannot be sent waits, in order, and goes on the next flush', async () => {
    hydrationApi.log.mockRejectedValue(
      new ApiError('network', 'No connection. Check your internet and try again.'),
    );
    useHydrationStore.getState().add(200);
    useHydrationStore.getState().add(300);
    await settle();
    expect(useHydrationStore.getState().outbox).toHaveLength(2);
    expect(hydrationApi.log).toHaveBeenCalledTimes(1);

    hydrationApi.log.mockImplementation(async (entry: { id: string; ml: number; at: string }) =>
      day([entry]),
    );
    await useHydrationStore.getState().flush();
    expect(useHydrationStore.getState().outbox).toEqual([]);
    expect(hydrationApi.log.mock.calls.slice(1).map(call => call[0].ml)).toEqual([200, 300]);
  });

  test('a drink the server refuses for good is dropped, not retried forever', async () => {
    hydrationApi.log.mockRejectedValue(
      new ApiError('validation', 'Log between 10 and 3000 ml.', 422),
    );
    useHydrationStore.getState().add(5);
    await settle();

    expect(useHydrationStore.getState().outbox).toEqual([]);
  });

  test('taking back a drink still waiting sends nothing; taking back a sent one asks the server', async () => {
    hydrationApi.log.mockRejectedValue(new ApiError('network', 'offline'));
    useHydrationStore.getState().add(200);
    useHydrationStore.getState().add(300);
    await settle();
    const second = useHydrationStore.getState().outbox[1] as {
      entry: { id: string };
    };

    useHydrationStore.getState().remove(second.entry.id);
    expect(useHydrationStore.getState().outbox).toHaveLength(1);
    // The flush that removal set off finds the network still down.
    await settle();

    useHydrationStore.setState({
      day: day([{ id: 'srv-1', ml: 500, at: new Date().toISOString() }]),
      outbox: [],
    });
    hydrationApi.remove.mockResolvedValue(day([]));
    useHydrationStore.getState().remove('srv-1');
    expect((await readView()).consumedMl).toBe(0);
    await settle();
    expect(hydrationApi.remove).toHaveBeenCalledWith('srv-1', {
      idempotencyKey: 'drink-remove:srv-1',
    });
    expect(useHydrationStore.getState().day?.entries).toEqual([]);
  });

  test("yesterday's day does not show as today's", async () => {
    useHydrationStore.setState({
      day: day([{ id: 'old', ml: 2000, at: '2020-01-01T08:00:00.000Z' }], '2020-01-01'),
    });

    expect(await readView()).toEqual({ synced: false, consumedMl: 0, entries: [] });
  });

  test("an older build's drinks from today are sent on; older ones go", () => {
    const migrate = useHydrationStore.persist.getOptions().migrate!;
    const entries = [
      { id: 'b', ml: 500, at: new Date().toISOString() },
      { id: 'a', ml: 250, at: new Date().toISOString() },
    ];

    expect(migrate({ date: todayIso(), consumedMl: 750, entries }, 2)).toEqual({
      day: null,
      outbox: [
        { kind: 'add', entry: entries[1] },
        { kind: 'add', entry: entries[0] },
      ],
      syncedAt: null,
    });
    expect(migrate({ date: '2020-01-01', consumedMl: 750, entries }, 2)).toEqual({
      day: null,
      outbox: [],
      syncedAt: null,
    });
  });
});

describe('HydrationCard', () => {
  test('shows the amount, the goal and the percentage', async () => {
    const tree = await render(
      <HydrationCard consumedMl={1600} goalMl={2500} onAdd={() => {}} />,
    );
    const text = allText(tree);

    expect(text).toContain('1.6');
    expect(text).toContain('/ 2.5 L');
    expect(text).toContain('64%');
  });

  test('the glasses are a second reading of the same number', async () => {
    const tree = await render(
      <HydrationCard consumedMl={1250} goalMl={2500} onAdd={() => {}} />,
    );

    const label = tree.root
      .findAll(n => typeof n.props?.accessibilityLabel === 'string')
      .map(n => n.props.accessibilityLabel as string)
      .find(l => l.includes('glasses'));

    // Half the goal, so half the glasses.
    expect(label).toBe('5 of 10 glasses');
  });

  test('each quick-add reports its own amount', async () => {
    const onAdd = jest.fn();
    const tree = await render(
      <HydrationCard consumedMl={0} goalMl={2500} onAdd={onAdd} />,
    );

    await ReactTestRenderer.act(() =>
      byLabel(tree, 'Add 200 millilitres')!.props.onPress(),
    );
    expect(onAdd).toHaveBeenCalledWith(200);

    await ReactTestRenderer.act(() =>
      byLabel(tree, 'Add 500 millilitres')!.props.onPress(),
    );
    expect(onAdd).toHaveBeenCalledWith(500);
  });

  test('a zero goal does not produce NaN or an endless row of glasses', async () => {
    const tree = await render(
      <HydrationCard consumedMl={500} goalMl={0} onAdd={() => {}} />,
    );

    expect(allText(tree)).not.toMatch(/NaN|Infinity/);
  });

  test('over-drinking caps the glasses instead of overflowing the row', async () => {
    const tree = await render(
      <HydrationCard consumedMl={9000} goalMl={2500} onAdd={() => {}} />,
    );

    const label = tree.root
      .findAll(n => typeof n.props?.accessibilityLabel === 'string')
      .map(n => n.props.accessibilityLabel as string)
      .find(l => l.includes('glasses'));

    expect(label).toBe('10 of 10 glasses');
  });
});

describe('QuickActionsRow', () => {
  const handlers = {
    onPressChallenges: jest.fn(),
    onPressNutrition: jest.fn(),
    onPressHealth: jest.fn(),
    onPressStreaks: jest.fn(),
  };

  test('the streak card reports the current run', async () => {
    const tree = await render(
      <QuickActionsRow streakDays={7} {...handlers} />,
    );
    // Title case, as the design sets it: the streak card's value is the one
    // label in the row that is not upper-cased.
    expect(allText(tree)).toContain('7 Days');
  });

  test('a one-day streak is singular', async () => {
    const tree = await render(
      <QuickActionsRow streakDays={1} {...handlers} />,
    );
    expect(allText(tree)).toContain('1 Day');
    expect(allText(tree)).not.toContain('1 Days');
  });

  test('each shortcut routes to its own handler', async () => {
    const tree = await render(
      <QuickActionsRow streakDays={3} {...handlers} />,
    );

    await ReactTestRenderer.act(() =>
      byLabel(tree, 'Health check up')!.props.onPress(),
    );

    expect(handlers.onPressHealth).toHaveBeenCalledTimes(1);
    expect(handlers.onPressChallenges).not.toHaveBeenCalled();
  });
});

describe('MotivationCard', () => {
  test('renders the quote', async () => {
    const tree = await render(<MotivationCard quote="Small steps every day." />);
    expect(allText(tree)).toContain('Small steps every day.');
  });

  test('is only tappable when it has a destination', async () => {
    const plain = await render(<MotivationCard quote="Keep going." />);
    expect(
      plain.root.findAll(n => n.props?.accessibilityRole === 'button'),
    ).toHaveLength(0);

    const onPress = jest.fn();
    const tappable = await render(
      <MotivationCard quote="Keep going." onPress={onPress} />,
    );
    await ReactTestRenderer.act(() =>
      byLabel(tappable, "Today's motivation: Keep going.")!.props.onPress(),
    );
    expect(onPress).toHaveBeenCalled();
  });

  test('closes with the emoji trio, hidden from screen readers', async () => {
    const tree = await render(<MotivationCard quote="Keep going." />);
    const text = allText(tree);

    for (const emoji of MOTIVATION_EMOJIS) {
      expect(text).toContain(emoji);
    }

    expect(
      tree.root.findAll(
        n =>
          typeof n.type === 'string' &&
          typeof n.props?.children === 'string' &&
          MOTIVATION_EMOJIS.includes(
            n.props.children as (typeof MOTIVATION_EMOJIS)[number],
          ) &&
          n.props.accessibilityElementsHidden !== true,
      ),
    ).toHaveLength(0);
  });

  test('a caller can swap in its own artwork', async () => {
    const tree = await render(
      <MotivationCard quote="Keep going." illustration={<Text>ART</Text>} />,
    );
    const text = allText(tree);

    expect(text).toContain('ART');
    expect(text).not.toContain(MOTIVATION_EMOJIS[0]);
  });
});
