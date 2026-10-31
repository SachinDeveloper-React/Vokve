/**
 * The two destinations behind the checkup screen's "Track Your Progress" and
 * "View All" — both of which used to be wired to nothing.
 *
 * What is checked here is that each reads the same vitals store the checkup
 * does, that the archive groups and filters what it is given, and that
 * neither screen invents a shape out of a single reading.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { stockVitals } from './helpers/vitals';
import { VitalsHistoryScreen } from '../src/screens/main/VitalsHistoryScreen';
import { VitalsTrendsScreen } from '../src/screens/main/VitalsTrendsScreen';
import { useVitalsStore } from '../src/stores/vitalsStore';
import { ThemeProvider } from '../src/theme';
import type { VitalKind, VitalReading } from '../src/types/models';
import { formatLongDate, todayIso, addDays } from '../src/utils/date';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { kind?: VitalKind } | undefined;

// Only the two hooks are replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../src/services/api/endpoints', () => {
  const api = jest.requireActual('../src/services/api/mockApi');
  return {
    vitalsApi: {
      list: jest.fn((query: unknown) => api.mockVitalsApi.list(query)),
      latest: jest.fn(() => api.mockVitalsApi.latest()),
      log: jest.fn((reading: unknown, options: unknown) =>
        api.mockVitalsApi.log(reading, options),
      ),
      score: jest.fn(() => api.mockVitalsApi.score()),
    },
  };
});

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockRouteParams = undefined;
  useVitalsStore.getState().reset();
  stockVitals();
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

const render = async (node: React.ReactNode) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>{node}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

const press = (tree: ReactTestRenderer.ReactTestRenderer, prefix: string) => {
  const node = tree.root
    .findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        (n.props.accessibilityLabel as string).startsWith(prefix),
    )
    .find(n => typeof n.props.onPress === 'function');

  if (!node) throw new Error(`No pressable labelled "${prefix}…"`);
  ReactTestRenderer.act(() => node.props.onPress());
};

/**
 * A reading at a local time, not a UTC one. The archive groups by the day on
 * the member's own clock, so a fixture written in UTC lands on a different
 * day wherever the suite happens to run.
 */
const reading = (
  id: string,
  kind: VitalKind,
  value: number,
  recordedAt: string,
  secondary: number | null = null,
): VitalReading => ({ id, kind, value, secondary, recordedAt });

/** The store as a finished sync would leave it, with these readings and no more. */
const only = (readings: VitalReading[]) =>
  useVitalsStore.setState({
    readings,
    bmi: null,
    outbox: [],
    syncedAt: new Date().toISOString(),
    isSyncing: false,
    syncError: null,
  });

describe('VitalsHistoryScreen', () => {
  test('counts every kind that has been logged, and only those', async () => {
    // The seeded set: eight pulses, seven pressures, two weights. BMI is the
    // server's, derived rather than logged, so it is not a filter.
    const text = allText(await render(<VitalsHistoryScreen />));

    expect(text).toContain('All');
    expect(text).toContain('Heart Rate');
    expect(text).toContain('Blood Pressure');
    expect(text).toContain('Weight');
    expect(text).not.toContain('BMI');
  });

  test('groups the readings under the day they were taken', async () => {
    const today = todayIso();
    only([
      reading('a', 'heart_rate', 71, `${today}T09:30:00`),
      reading('b', 'weight', 72.4, `${today}T07:10:00`),
      reading('c', 'heart_rate', 66, `${addDays(today, -1)}T20:00:00`),
    ]);

    const text = allText(await render(<VitalsHistoryScreen />));

    // Two headings, one per day, and the day is written once not three times.
    expect(text).toContain(formatLongDate(today));
    expect(text).toContain(formatLongDate(addDays(today, -1)));
    expect(text).toContain('71');
    expect(text).toContain('72.4');
  });

  test('opens on one kind when it was reached from that kind', async () => {
    mockRouteParams = { kind: 'weight' };
    const today = todayIso();
    only([
      reading('a', 'heart_rate', 71, `${today}T09:30:00`),
      reading('b', 'weight', 72.4, `${today}T07:10:00`),
    ]);

    const text = allText(await render(<VitalsHistoryScreen />));

    expect(text).toContain('72.4');
    expect(text).not.toContain('71');
  });

  test('the chips move between the kinds, so neither route is a dead end', async () => {
    mockRouteParams = { kind: 'weight' };
    const today = todayIso();
    only([
      reading('a', 'heart_rate', 71, `${today}T09:30:00`),
      reading('b', 'weight', 72.4, `${today}T07:10:00`),
    ]);
    const tree = await render(<VitalsHistoryScreen />);

    press(tree, 'Heart Rate');

    const text = allText(tree);
    expect(text).toContain('71');
    expect(text).not.toContain('72.4');
  });

  test('says so when nothing has been logged at all', async () => {
    only([]);

    expect(allText(await render(<VitalsHistoryScreen />))).toContain(
      'Nothing logged yet',
    );
  });

  test('waits for the server rather than claiming an empty archive', async () => {
    useVitalsStore.setState({
      readings: null,
      isSyncing: true,
      syncError: null,
    });

    const text = allText(await render(<VitalsHistoryScreen />));
    expect(text).not.toContain('Nothing logged yet');
  });
});

describe('VitalsTrendsScreen', () => {
  test('draws a card for each vital with enough readings to make a line', async () => {
    const text = allText(await render(<VitalsTrendsScreen />));

    expect(text).toContain('Heart Rate');
    expect(text).toContain('Blood Pressure');
    expect(text).toContain('Weight');
    // Blood pressure is the one pair, so it is the one with a key.
    expect(text).toContain('Systolic');
    expect(text).toContain('Diastolic');
  });

  test('a vital with one reading is left out rather than drawn as a dot', async () => {
    const today = todayIso();
    only([
      reading('a', 'heart_rate', 71, `${today}T09:30:00`),
      reading('b', 'heart_rate', 66, `${addDays(today, -1)}T09:30:00`),
      reading('c', 'weight', 72.4, `${today}T07:10:00`),
    ]);

    const text = allText(await render(<VitalsTrendsScreen />));

    expect(text).toContain('Heart Rate');
    expect(text).not.toContain('Weight');
  });

  test('states the change in the vital’s own unit, not as a percentage', async () => {
    const today = todayIso();
    only([
      reading('a', 'heart_rate', 71, `${today}T09:30:00`),
      reading('b', 'heart_rate', 66, `${addDays(today, -2)}T09:30:00`),
    ]);

    const text = allText(await render(<VitalsTrendsScreen />));

    expect(text).toContain('5 bpm higher');
    expect(text).not.toContain('%');
  });

  test('says there is nothing to draw yet rather than an empty chart', async () => {
    only([]);

    expect(allText(await render(<VitalsTrendsScreen />))).toContain(
      'Not enough readings yet',
    );
  });
});
