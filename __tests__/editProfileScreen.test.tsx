/**
 * The profile form. The checks are that the member's own figures are *on* the
 * screen — the height and the weight the server holds, not an empty field —
 * that an answer arriving after the form was built is still applied, that it
 * never lands on top of something the member is typing, and that what is
 * saved is canonical centimetres and kilograms whichever system was typed in.
 *
 * @format
 */

import React from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { EditProfileScreen } from '../src/screens/main/EditProfileScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { useAuthStore } from '../src/stores/authStore';
import { useCoinsStore } from '../src/stores/coinsStore';
import { useSettingsStore } from '../src/stores/settingsStore';
import type { User } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: undefined }),
}));

jest.mock('../src/services/api/endpoints', () => ({
  userApi: { me: jest.fn(), updateProfile: jest.fn(), uploadAvatar: jest.fn() },
  accountApi: { profile: jest.fn() },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
}));

const { userApi, accountApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  userApi: { me: jest.Mock; updateProfile: jest.Mock; uploadAvatar: jest.Mock };
  accountApi: { profile: jest.Mock };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const member = (over: Partial<User> = {}): User =>
  ({
    id: 'u-1',
    name: 'Rana Jay',
    email: 'rana@vokve.app',
    avatarUrl: null,
    heightCm: 175,
    weightKg: 70.5,
    dateOfBirth: '1994-03-21',
    phone: null,
    profileCompletedAt: '2026-01-01T00:00:00.000Z',
    gender: 'male',
    goal: 'stay_active',
    activityLevel: 'moderate',
    units: 'metric',
    streakDays: 3,
    weeklyGoalWorkouts: 4,
    createdAt: null,
    country: 'IN',
    phoneVerifiedAt: null,
    emailVerifiedAt: null,
    trustTier: 'normal',
    ...over,
  }) as unknown as User;

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  userApi.me.mockReset().mockResolvedValue(member());
  userApi.updateProfile.mockReset().mockImplementation(async () => member());
  accountApi.profile.mockReset().mockRejectedValue(new Error('offline'));
  useAuthStore.setState({ user: member(), status: 'authenticated' });
  useCoinsStore.setState({ balance: 1_000 });
  useSettingsStore.setState({ units: 'metric' });
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
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  });

const render = async ({ wait = true } = {}) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>
            <EditProfileScreen />
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  if (wait) await settle();
  return tree;
};

/** Every text field's current value, in render order. */
const inputs = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(RNTextInput);

const valueOf = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  inputs(tree).find(node => node.props.accessibilityLabel === label)?.props
    .value;

const type = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
  text: string,
) => {
  const node = inputs(tree).find(n => n.props.accessibilityLabel === label);
  if (!node) throw new Error(`No field labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onChangeText(text);
  });
};

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    await node.props.onPress();
  });
};

describe('EditProfileScreen', () => {
  test("shows the member's own height and weight", async () => {
    const tree = await render();

    expect(valueOf(tree, 'Height')).toBe('175');
    expect(valueOf(tree, 'Weight')).toBe('70.5');
    expect(valueOf(tree, 'Full name')).toBe('Rana Jay');
  });

  test('asks the server for the profile again on the way in', async () => {
    await render();

    expect(userApi.me).toHaveBeenCalledTimes(1);
  });

  test('figures that arrive after the form was built are still shown', async () => {
    // The session's copy has no measurements — the member set their weight on
    // the health screen, or on another phone, and this install never heard.
    useAuthStore.setState({ user: member({ heightCm: null, weightKg: null }) });
    let answer: (user: User) => void = () => {};
    userApi.me.mockImplementation(
      () => new Promise<User>(resolve => (answer = resolve)),
    );

    const tree = await render({ wait: false });
    // Nothing to show yet: this is the state the screen used to be stuck in.
    expect(valueOf(tree, 'Height')).toBe('');
    expect(valueOf(tree, 'Weight')).toBe('');

    await ReactTestRenderer.act(async () => {
      answer(member({ heightCm: 168, weightKg: 61.2 }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await settle();

    expect(valueOf(tree, 'Height')).toBe('168');
    expect(valueOf(tree, 'Weight')).toBe('61.2');
  });

  test('an answer that lands late does not overwrite what is being typed', async () => {
    let answer: (user: User) => void = () => {};
    userApi.me.mockImplementation(
      () => new Promise<User>(resolve => (answer = resolve)),
    );

    const tree = await render({ wait: false });
    await type(tree, 'Weight', '64');

    await ReactTestRenderer.act(async () => {
      answer(member({ weightKg: 99 }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await settle();

    expect(valueOf(tree, 'Weight')).toBe('64');
  });

  test('saves canonical centimetres and kilograms, and the units chosen', async () => {
    const tree = await render();

    await type(tree, 'Height', '172');
    await type(tree, 'Weight', '68.4');
    await press(tree, 'Save changes');
    await settle();

    expect(userApi.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ heightCm: 172, weightKg: 68.4, units: 'metric' }),
    );
  });

  test('imperial converts what is typed and is picked in feet and inches', async () => {
    const tree = await render();

    // The unit chip on either field switches the system for both.
    await press(tree, 'Unit: kg');
    expect(valueOf(tree, 'Weight')).toBe('155.4'); // 70.5 kg
    // Height is no longer a typed field: imperial height is picked.
    expect(valueOf(tree, 'Height')).toBeUndefined();
    expect(textOf(tree, RNText)).toContain('5\' 9"'); // 175 cm

    await type(tree, 'Weight', '150');
    await press(tree, 'Save changes');
    await settle();

    expect(userApi.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ units: 'imperial', weightKg: 68 }),
    );
  });
});
