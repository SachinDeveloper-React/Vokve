/**
 * The referral screen's three figures are counted from its own list, and its
 * two actions go through the platform, so the checks here are that the counts
 * agree with the rows, that copy and share reach the clipboard and the share
 * sheet with the code in them, and that a pending friend is never shown as
 * paid.
 *
 * @format
 */

import React from 'react';
import { Share, Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import { textOf } from './helpers/text';
import { ReferralScreen } from '../src/screens/main/ReferralScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { referralCode, seedReferrals } from '../src/constants/seedData';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  (Clipboard.setString as jest.Mock).mockClear();
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

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>
            <ReferralScreen />
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

const labels = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll(n => typeof n.props?.accessibilityLabel === 'string')
    .map(n => n.props.accessibilityLabel as string);

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  prefix: string,
) => {
  const node = tree.root
    .findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        (n.props.accessibilityLabel as string).startsWith(prefix),
    )
    .find(n => typeof n.props.onPress === 'function');

  if (!node) throw new Error(`No pressable labelled "${prefix}…"`);
  await ReactTestRenderer.act(async () => {
    await node.props.onPress();
  });
};

describe('ReferralScreen', () => {
  test('the figures are counted from the list under them', async () => {
    const rewarded = seedReferrals.filter(r => r.status === 'rewarded');
    const pending = seedReferrals.length - rewarded.length;
    const coins = rewarded.reduce((sum, r) => sum + r.rewardCoins, 0);

    const text = allText(await render());

    expect(text).toContain(String(rewarded.length)); // 18
    expect(text).toContain(String(pending)); // 2
    expect(text).toContain(String(coins)); // 360
    expect(rewarded.length).toBe(18);
    expect(coins).toBe(360);
  });

  test('the code is on screen and copies to the clipboard', async () => {
    const tree = await render();
    expect(allText(tree)).toContain(referralCode);

    await press(tree, 'Your referral code');

    expect(Clipboard.setString).toHaveBeenCalledWith(referralCode);
    expect(allText(tree)).toContain('Code copied');
  });

  test('sharing hands the code to the system share sheet', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });

    await press(await render(), 'Share Your Code');

    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].message).toContain(referralCode);
    share.mockRestore();
  });

  test('a dismissed share sheet is not an error', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockRejectedValue(new Error('dismissed'));

    await expect(press(await render(), 'Share Your Code')).resolves.toBeUndefined();
    share.mockRestore();
  });

  test('a pending friend is not shown as paid', async () => {
    const rows = labels(await render());

    expect(
      rows.some(label => label.startsWith('Arjun Mehta') && label.includes('pending verification')),
    ).toBe(true);
    expect(
      rows.some(label => label.startsWith('Rohit Sharma') && label.includes('reward claimed')),
    ).toBe(true);
  });

  test('the four steps are on screen with their one rule', async () => {
    const text = allText(await render());

    expect(text).toContain('1. Share Code');
    expect(text).toContain('4. Get Reward');
    expect(text).toContain('One referral = One-time reward');
  });

  test('the chevron returns to whatever opened the screen', async () => {
    await press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
