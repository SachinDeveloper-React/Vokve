/**
 * Referral & Earn states amounts the owner can change and hands a code to
 * other apps, so the checks here are that every figure and every share
 * string is the server's, that a friend's code can be claimed and its refusals
 * are worded, that a pending friend is never shown as paid, and that the
 * two actions reach the clipboard and the share sheet with the code in them.
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
import { ApiError } from '../src/services/api/errors';
import { useAuthStore } from '../src/stores/authStore';
import { useReferralStore } from '../src/stores/referralStore';
import type { Referral, ReferralProgram } from '../src/types/models';

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
    addListener: jest.fn(() => jest.fn()),
  }),
}));

jest.mock('../src/services/api/endpoints', () => ({
  referralApi: { me: jest.fn(), list: jest.fn(), apply: jest.fn() },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
  notificationApi: {
    list: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
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
  shopApi: { items: jest.fn(), item: jest.fn(), config: jest.fn() },
  cartApi: { get: jest.fn(), setLine: jest.fn(), removeLine: jest.fn(), clear: jest.fn() },
  wishlistApi: { list: jest.fn(), ids: jest.fn(), add: jest.fn(), remove: jest.fn() },
  checkoutApi: { quote: jest.fn(), place: jest.fn(), pay: jest.fn() },
  authApi: { stepUp: jest.fn(), signOut: jest.fn() },
}));

const { referralApi } = jest.requireMock('../src/services/api/endpoints') as {
  referralApi: { me: jest.Mock; list: jest.Mock; apply: jest.Mock };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const friend = (
  id: string,
  name: string,
  status: Referral['status'],
  rewardCoins = 35,
): Referral => ({
  id,
  name,
  joinedAt: '2026-09-10',
  status,
  rewardCoins,
});

/** A programme as the server serves it — with amounts the seed never used, so nothing hardcoded can pass. */
const program = (
  overrides: Partial<ReferralProgram> = {},
): ReferralProgram => ({
  code: 'KX7M2QP',
  shareUrl: 'https://vokve.app/r/KX7M2QP?c=sept',
  shareMessage:
    'Join me on VOKVE with code KX7M2QP: https://vokve.app/r/KX7M2QP?c=sept',
  rewards: {
    inviter: 35,
    invitee: 45,
    qualifier: "your friend's first workout",
    monthlyInviterCap: 10,
  },
  stats: { successful: 2, pending: 1, coinsEarned: 70, rewardedThisMonth: 2 },
  referrals: [
    friend('r1', 'Arjun Mehta', 'pending'),
    friend('r2', 'Rohit Sharma', 'rewarded'),
    friend('r3', 'Priya Nair', 'rewarded'),
  ],
  applied: null,
  canApply: true,
  applyBy: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  ...overrides,
});

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  (Clipboard.setString as jest.Mock).mockClear();
  referralApi.me.mockReset().mockResolvedValue(program());
  referralApi.list.mockReset();
  referralApi.apply.mockReset();
  useReferralStore.getState().reset();
  useAuthStore.setState({ status: 'authenticated' });
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

const settle = () =>
  ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
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
  await settle();
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
  await settle();
};

const pressButton = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = tree.root
    .findAll(
      n => n.props?.label === label && typeof n.props.onPress === 'function',
    )
    .at(-1);
  if (!node) throw new Error(`No button labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
};

const typeCode = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  value: string,
) => {
  const input = tree.root
    .findAll(
      n =>
        n.props?.accessibilityLabel === "Friend's referral code" &&
        typeof n.props.onChangeText === 'function',
    )
    .at(-1);
  if (!input) throw new Error('No code field');
  await ReactTestRenderer.act(async () => {
    input.props.onChangeText(value);
  });
};

describe('ReferralScreen', () => {
  test("fetches the programme on open and shows the server's code, figures and amounts", async () => {
    const text = allText(await render());

    expect(referralApi.me).toHaveBeenCalled();
    expect(text).toContain('KX7M2QP');
    expect(text).toContain('70'); // coins earned, the server's
    expect(text).toContain('earn 35 coins for every friend'); // the hero, from rewards.inviter
    expect(text).toContain('You get 35 coins and your friend gets 45'); // the rule card
    expect(text).toContain(
      "The reward unlocks on your friend's first workout.",
    );
    expect(text).not.toContain('VOKVE123'); // the seed is gone
  });

  test('before the first sync nothing is promised: a spinner, then a retry if it fails', async () => {
    referralApi.me.mockRejectedValue(new Error('offline'));

    const tree = await render();

    const text = allText(tree);
    expect(text).toContain("Couldn't load your code");
    expect(text).not.toContain('coins for every friend');
    referralApi.me.mockResolvedValue(program());
    await pressButton(tree, 'Try again');
    expect(allText(tree)).toContain('KX7M2QP');
  });

  test('the code copies to the clipboard', async () => {
    const tree = await render();

    await press(tree, 'Your referral code');

    expect(Clipboard.setString).toHaveBeenCalledWith('KX7M2QP');
    expect(allText(tree)).toContain('Code copied');
  });

  test("sharing hands the server's message and link to the share sheet (RULES F6)", async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({
        action: Share.sharedAction,
        activityType: undefined,
      });

    await press(await render(), 'Share Your Code');

    expect(share).toHaveBeenCalledWith({
      message:
        'Join me on VOKVE with code KX7M2QP: https://vokve.app/r/KX7M2QP?c=sept',
      url: 'https://vokve.app/r/KX7M2QP?c=sept',
    });
    share.mockRestore();
  });

  test('a dismissed share sheet is not an error', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockRejectedValue(new Error('dismissed'));

    await expect(
      press(await render(), 'Share Your Code'),
    ).resolves.toBeUndefined();
    share.mockRestore();
  });

  test('a pending friend is not shown as paid', async () => {
    const rows = labels(await render());

    expect(
      rows.some(
        label =>
          label.startsWith('Arjun Mehta') &&
          label.includes('pending verification'),
      ),
    ).toBe(true);
    expect(
      rows.some(
        label =>
          label.startsWith('Rohit Sharma') && label.includes('reward claimed'),
      ),
    ).toBe(true);
  });

  describe("claiming a friend's code", () => {
    test("the claim card promises the server's invitee amount and applies the typed code", async () => {
      referralApi.apply.mockResolvedValue(
        program({
          applied: {
            code: 'ASHA2K7',
            inviterName: 'Asha',
            status: 'pending',
            rewardCoins: 45,
            appliedAt: new Date().toISOString(),
          },
          canApply: false,
          applyBy: null,
        }),
      );
      const tree = await render();
      expect(allText(tree)).toContain(
        "Skipped a friend's code at sign-up? Claim 45 coins",
      );

      await typeCode(tree, 'asha2k7');
      await pressButton(tree, 'Claim 45 coins');

      expect(referralApi.apply).toHaveBeenCalledWith('ASHA2K7');
      const text = allText(tree);
      expect(text).toContain('45 coins on the way');
      expect(text).toContain("You joined on Asha's code");
      expect(text).not.toContain("Skipped a friend's code");
    });

    test('a refused code is worded on the field, and typing clears it', async () => {
      referralApi.apply.mockRejectedValue(
        new ApiError(
          'not_found',
          'That code does not match anyone.',
          404,
          null,
          'REFERRAL_CODE_INVALID',
        ),
      );
      const tree = await render();

      await typeCode(tree, 'ZZZZZZZ');
      await pressButton(tree, 'Claim 45 coins');

      expect(allText(tree)).toContain("That code doesn't match anyone");
      await typeCode(tree, 'ZZZZZZ');
      // The field's message goes; the toast's copy of it may still be on screen.
      const field = tree.root
        .findAll(n => n.props?.accessibilityLabel === "Friend's referral code")
        .at(-1);
      expect(field?.props.error).toBeUndefined();
    });

    test('your own code is refused with its own words', async () => {
      referralApi.apply.mockRejectedValue(
        new ApiError(
          'validation',
          'That is your own code.',
          422,
          null,
          'REFERRAL_SELF',
        ),
      );
      const tree = await render();

      await typeCode(tree, 'KX7M2QP');
      await pressButton(tree, 'Claim 45 coins');

      expect(allText(tree)).toContain("That's your own code");
    });

    test('once rewarded, the card shows the claim as done', async () => {
      referralApi.me.mockResolvedValue(
        program({
          applied: {
            code: 'ASHA2K7',
            inviterName: 'Asha',
            status: 'rewarded',
            rewardCoins: 45,
            appliedAt: new Date().toISOString(),
          },
          canApply: false,
          applyBy: null,
        }),
      );

      const text = allText(await render());

      expect(text).toContain('45 coins claimed');
      expect(text).not.toContain('Claim 45 coins');
    });

    test('a closed window offers no field at all', async () => {
      referralApi.me.mockResolvedValue(
        program({ canApply: false, applyBy: null }),
      );

      const text = allText(await render());

      expect(text).not.toContain("Skipped a friend's code");
      expect(text).not.toContain('coins claimed');
    });
  });

  test('"View All" shows every fetched row, then pages from the server', async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      friend(`r${i}`, `Friend ${i}`, 'rewarded'),
    );
    referralApi.me.mockResolvedValue(program({ referrals: many }));
    referralApi.list.mockResolvedValue({
      data: [friend('r20', 'Friend 20', 'pending')],
      nextCursor: null,
    });
    const tree = await render();

    // Three rows above the fold.
    let text = allText(tree);
    expect(text).toContain('Friend 2');
    expect(text).not.toContain('Friend 3');

    await press(tree, 'View all referrals');
    text = allText(tree);
    expect(text).toContain('Friend 19');
    expect(referralApi.list).not.toHaveBeenCalled();

    await press(tree, 'Load more referrals');
    expect(referralApi.list).toHaveBeenCalledWith('r19');
    expect(allText(tree)).toContain('Friend 20');
  });

  test('the chevron returns to whatever opened the screen', async () => {
    await press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
