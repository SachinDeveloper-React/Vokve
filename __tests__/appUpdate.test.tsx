/**
 * What a build does about its own version (RULES DV12): a wall it cannot
 * get past, a knock it can put off, or nothing at all — and the rule that
 * makes the knock bearable, which is that "Later" is remembered.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf as collectText } from './helpers/text';
import { UpdateSheet } from '../src/components/system/UpdateSheet';
import { UpgradeRequiredScreen } from '../src/screens/system/UpgradeRequiredScreen';
import { ThemeProvider } from '../src/theme';
import { useAppStatusStore } from '../src/stores/appStatusStore';
import type { AppUpdate } from '../src/types/models';

jest.mock('../src/services/api/endpoints', () => ({
  ...jest.requireActual('../src/services/api/endpoints'),
  appApi: { about: jest.fn(), update: jest.fn() },
}));

const { appApi } = jest.requireMock('../src/services/api/endpoints') as {
  appApi: { update: jest.Mock };
};

const {
  useAppUpdate,
} = require('../src/hooks/useAppUpdate') as typeof import('../src/hooks/useAppUpdate');
const { getMMKV } = require('../src/stores') as typeof import('../src/stores');

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const verdict = (over: Partial<AppUpdate> = {}): AppUpdate => ({
  status: 'soft',
  installed: { version: '1.2.0', build: '12' },
  latest: { version: '1.3.0', build: '13', releasedAt: null, notes: 'Faster step sync.' },
  minVersion: '1.0.0',
  storeUrl: 'https://play.google.com/store/apps/details?id=com.vokve',
  title: 'A new VOKVE is out',
  message: 'Version 1.3.0 is ready.',
  actionLabel: 'Update now',
  laterLabel: 'Later',
  dismissible: true,
  remindAfterHours: 24,
  reason: 'newer_available',
  ...over,
});

beforeEach(() => {
  getMMKV().clearAll();
  useAppStatusStore.setState({ update: null, upgradeRequired: null });
  appApi.update.mockResolvedValue(verdict({ status: 'none', reason: null }));
});

afterEach(() => {
  jest.clearAllMocks();
});

/** Mounts the hook alone and hands back what it decided, re-read on demand. */
async function renderHook() {
  const seen: { current: ReturnType<typeof useAppUpdate> } = { current: null as never };
  const Probe = () => {
    seen.current = useAppUpdate();
    return null;
  };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<Probe />);
  });
  return { seen, tree };
}

const render = async (node: React.ReactElement) => {
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

describe('the update check', () => {
  it('asks the server on mount and keeps the verdict', async () => {
    appApi.update.mockResolvedValue(verdict());
    const { seen } = await renderHook();
    expect(appApi.update).toHaveBeenCalledTimes(1);
    expect(seen.current.update).toMatchObject({ status: 'soft', title: 'A new VOKVE is out' });
  });

  it('says nothing when the build is current', async () => {
    const { seen } = await renderHook();
    expect(seen.current.update).toBeNull();
  });

  it('never shows a hard verdict as a sheet — that one is the wall', async () => {
    appApi.update.mockResolvedValue(verdict({ status: 'hard', dismissible: false, laterLabel: null, remindAfterHours: null }));
    const { seen } = await renderHook();
    expect(seen.current.update).toBeNull();
    expect(useAppStatusStore.getState().update?.status).toBe('hard');
  });

  it('carries on when the check cannot be made', async () => {
    appApi.update.mockRejectedValue(new Error('offline'));
    const { seen } = await renderHook();
    expect(seen.current.update).toBeNull();
  });

  it('remembers a "Later" for as long as the server asked, and asks again for a newer release', async () => {
    appApi.update.mockResolvedValue(verdict());
    const first = await renderHook();
    expect(first.seen.current.update).not.toBeNull();

    await ReactTestRenderer.act(async () => {
      first.seen.current.dismiss();
    });
    expect(first.seen.current.update).toBeNull();

    // A relaunch inside the window: still quiet.
    const again = await renderHook();
    expect(again.seen.current.update).toBeNull();

    // The same prompt, 25 hours later: asked again.
    const stored = JSON.parse(getMMKV().getString('vokve.update.dismissed') ?? '{}');
    getMMKV().set(
      'vokve.update.dismissed',
      JSON.stringify({ ...stored, at: Date.now() - 25 * 3_600_000 }),
    );
    const later = await renderHook();
    expect(later.seen.current.update).not.toBeNull();
  });

  it('asks again at once when the release it was dismissed for is superseded', async () => {
    appApi.update.mockResolvedValue(verdict());
    const first = await renderHook();
    await ReactTestRenderer.act(async () => {
      first.seen.current.dismiss();
    });

    appApi.update.mockResolvedValue(
      verdict({ latest: { version: '1.4.0', build: '14', releasedAt: null, notes: null }, message: 'Version 1.4.0 is ready.' }),
    );
    const next = await renderHook();
    expect(next.seen.current.update).toMatchObject({ message: 'Version 1.4.0 is ready.' });
  });
});

describe('the knock', () => {
  it('draws the server’s words, its notes and both buttons', async () => {
    const tree = await render(<UpdateSheet update={verdict()} onDismiss={jest.fn()} />);
    const text = collectText(tree, Text);
    expect(text).toContain('A new VOKVE is out');
    expect(text).toContain('Version 1.3.0 is ready.');
    expect(text).toContain('Faster step sync.');
    expect(text).toContain('Update now');
    expect(text).toContain('Later');
  });

  it('shows nothing at all when there is nothing to say', async () => {
    const tree = await render(<UpdateSheet update={null} onDismiss={jest.fn()} />);
    expect(collectText(tree, Text)).not.toContain('Update now');
  });
});

describe('the wall', () => {
  it('draws the server’s heading, message and button, with no way past it', async () => {
    useAppStatusStore.setState({
      update: verdict({ status: 'hard', dismissible: false, laterLabel: null, remindAfterHours: null, title: 'Zaroori update', message: 'Purana version band ho gaya.', actionLabel: 'Open Play Store', minVersion: '1.3.0' }),
    });
    const tree = await render(<UpgradeRequiredScreen />);
    const text = collectText(tree, Text);
    expect(text).toContain('Zaroori update');
    expect(text).toContain('Purana version band ho gaya.');
    expect(text).toContain('Open Play Store');
    expect(text).toContain('needs 1.3.0 or newer');
    // Nothing that could dismiss it.
    expect(text).not.toContain('Later');
  });

  it('is drawn for a refused request too, in the server’s own words', async () => {
    useAppStatusStore.setState({
      upgradeRequired: { storeUrl: 'https://play.google.com/store', minVersion: '2.0.0', message: 'Please update VOKVE to continue.' },
    });
    const text = collectText(await render(<UpgradeRequiredScreen />), Text);
    expect(text).toContain('Update VOKVE to continue');
    expect(text).toContain('Please update VOKVE to continue.');
    expect(text).toContain('Open the store');
  });
});
