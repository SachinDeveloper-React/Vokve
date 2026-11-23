/**
 * Maintenance mode (RULES DV14): the server refuses members with 503
 * `MAINTENANCE` while the team works, and the app draws the maintenance
 * screen in place of everything — lifting it by itself once the server says
 * it is over. Testers and staff carry on through it, with a strip above the
 * app saying so, and a signed-out tester gets in through "Team sign-in".
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { textOf as collectText } from './helpers/text';
import { RootNavigator } from '../src/navigation/RootNavigator';
import { ThemeProvider } from '../src/theme';
import { ToastProvider } from '../src/components/feedback';
import { appApi } from '../src/services/api/endpoints';
import { toApiError } from '../src/services/api/errors';
import {
  useAppStatusStore,
  type MaintenanceNotice,
} from '../src/stores/appStatusStore';
import { useAuthStore } from '../src/stores/authStore';
import { checkMaintenance } from '../src/hooks/useMaintenance';
import { expectedBack } from '../src/screens/system/MaintenanceScreen';

let mockBypassAuthInDev = true;

jest.mock('../src/constants/config', () => ({
  config: {
    apiBaseUrl: 'https://example.test/v1',
    requestTimeoutMs: 1000,
    maxRetries: 0,
    retryBaseDelayMs: 1,
    get bypassAuthInDev() {
      return mockBypassAuthInDev;
    },
  },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const globals = globalThis as unknown as { __DEV__: boolean };
let realDev: boolean;

const OFF: MaintenanceNotice = {
  active: false,
  bypass: false,
  title: "We'll be right back",
  message: '',
  endsAt: null,
};
const ON: MaintenanceNotice = {
  active: true,
  bypass: false,
  title: 'Back soon',
  message: 'Upgrading the servers.',
  endsAt: null,
};

let statusSpy: jest.SpyInstance;

beforeEach(() => {
  realDev = globals.__DEV__;
  mockBypassAuthInDev = true;
  statusSpy = jest
    .spyOn(appApi, 'status')
    .mockResolvedValue({ maintenance: OFF });
  useAppStatusStore.setState({
    maintenance: null,
    maintenanceSignIn: false,
    upgradeRequired: null,
  });
});

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
  globals.__DEV__ = realDev;
  statusSpy.mockRestore();
  useAppStatusStore.setState({ maintenance: null, maintenanceSignIn: false });
});

const renderGate = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree);
  return tree;
};

const textOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  collectText(tree, Text);
const APP_MARKER = 'Stay active, stay healthy!';
const SIGN_IN_MARKER = 'Train with intent.';

/** The server's answer to `GET /app/status` from now on, and the check that reads it. */
async function serverSays(maintenance: MaintenanceNotice) {
  statusSpy.mockResolvedValue({ maintenance });
  await ReactTestRenderer.act(async () => {
    await checkMaintenance();
  });
}

describe('what the server says', () => {
  const answer = (status: number, data: unknown) => {
    const config = { headers: {} } as InternalAxiosRequestConfig;
    return new AxiosError(
      'Refused',
      String(status),
      config,
      {},
      { status, statusText: '', data, headers: {}, config },
    );
  };

  test('a 503 is maintenance only when the server says so', () => {
    const maintenance = toApiError(
      answer(503, {
        error: {
          code: 'MAINTENANCE',
          message: 'Upgrading the servers.',
          details: { title: 'Back soon', endsAt: null },
        },
      }),
    );
    expect(maintenance.kind).toBe('maintenance');
    expect(maintenance.message).toBe('Upgrading the servers.');
    expect(maintenance.details).toEqual({ title: 'Back soon', endsAt: null });
    // A proxy's 503 is the server being down, a different screen.
    expect(
      toApiError(answer(503, '<html>Service Unavailable</html>')).kind,
    ).toBe('server');
  });

  test('the expected end reads as a time today, with the date on another day, and not at all once past', () => {
    const now = new Date(2026, 10, 23, 10, 0);
    expect(
      expectedBack(new Date(2026, 10, 23, 15, 30).toISOString(), now),
    ).toBe('3:30 PM');
    expect(expectedBack(new Date(2026, 10, 24, 9, 0).toISOString(), now)).toBe(
      '9:00 AM, 24 November 2026',
    );
    expect(
      expectedBack(new Date(2026, 10, 23, 9, 0).toISOString(), now),
    ).toBeNull();
    expect(expectedBack(null, now)).toBeNull();
  });
});

describe('the maintenance screen', () => {
  test('replaces a live session, in the server’s words, and lifts by itself when it is over', async () => {
    globals.__DEV__ = true;
    const tree = await renderGate();
    expect(textOf(tree)).toContain(APP_MARKER);

    const endsAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
    await serverSays({ ...ON, endsAt });
    const text = textOf(tree);
    expect(text).toContain('Back soon');
    expect(text).toContain('Upgrading the servers.');
    expect(text).toContain('Expected back by');
    expect(text).toContain('Try again');
    expect(text).not.toContain(APP_MARKER);
    // Signed in, so no way past it. (The dev bypass leaves the session
    // signed out underneath; a real one is authenticated.)
    await ReactTestRenderer.act(() => {
      useAuthStore.setState({ status: 'authenticated' });
    });
    expect(textOf(tree)).not.toContain('Team sign-in');
    await ReactTestRenderer.act(() => {
      useAuthStore.setState({ status: 'signed_out' });
    });

    await serverSays(OFF);
    expect(textOf(tree)).toContain(APP_MARKER);
    expect(useAppStatusStore.getState().maintenance).toBeNull();
  });

  test('a tester carries on, with the strip saying maintenance is on', async () => {
    globals.__DEV__ = true;
    const tree = await renderGate();
    await serverSays({ ...ON, bypass: true });

    const text = textOf(tree);
    expect(text).toContain(APP_MARKER);
    expect(text).toContain(
      'Maintenance mode · members see the maintenance screen',
    );
    expect(
      tree.root.findAllByProps({ testID: 'maintenance-strip' }).length,
    ).toBeGreaterThan(0);

    await serverSays(OFF);
    expect(textOf(tree)).not.toContain('Maintenance mode');
  });

  test('a signed-out phone can go on to sign in as a team member, under the strip', async () => {
    globals.__DEV__ = false;
    const tree = await renderGate();
    expect(textOf(tree)).toContain(SIGN_IN_MARKER);

    await serverSays(ON);
    expect(textOf(tree)).not.toContain(SIGN_IN_MARKER);

    const button = tree.root.findAll(
      node =>
        node.props.accessibilityLabel === 'Team sign-in' &&
        typeof node.props.onPress === 'function',
    )[0];
    expect(button).toBeDefined();
    await ReactTestRenderer.act(() => {
      button.props.onPress();
    });
    const text = textOf(tree);
    expect(text).toContain(SIGN_IN_MARKER);
    expect(text).toContain('Maintenance mode · team sign-in only');
  });

  test('a session that could not be confirmed during maintenance is asked about again once it is over', async () => {
    globals.__DEV__ = false;
    const tree = await renderGate();
    await serverSays(ON);
    const hydrate = jest
      .spyOn(useAuthStore.getState(), 'hydrate')
      .mockResolvedValue(undefined);
    await ReactTestRenderer.act(() => {
      useAuthStore.setState({
        status: 'unreachable',
        isSubmitting: false,
        hydrate,
      });
    });
    // Whatever the navigator itself asked on the way, the count starts here.
    hydrate.mockClear();

    await serverSays(OFF);
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(textOf(tree)).not.toContain('Upgrading the servers.');
    hydrate.mockRestore();
  });
});
