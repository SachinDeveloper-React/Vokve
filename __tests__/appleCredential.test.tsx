/**
 * Noticing when a member withdraws VOKVE from their Apple ID (RULES O16).
 *
 * Apple asks apps that offer Sign in with Apple to check the credential at
 * launch and listen for its revocation, and to sign out a session Apple
 * was the way into. What is checked here: only such a session is watched;
 * `revoked` signs it out with a line saying why; anything Apple could not
 * answer — or answered with "not found" — leaves the member where they are.
 *
 * @format
 */

import React from 'react';
import { Platform } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import {
  appleCredentialState,
  forgetAppleUser,
  rememberAppleUser,
  rememberedAppleUser,
} from '../src/services/appleCredential';
import { useAppleCredentialWatch } from '../src/hooks/useAppleCredentialWatch';
import { useAuthStore } from '../src/stores/authStore';

const getState = appleAuth.getCredentialStateForUser as jest.Mock;
const onRevoked = appleAuth.onCredentialRevoked as jest.Mock;

const Watcher = () => {
  useAppleCredentialWatch();
  return null;
};

const flush = () =>
  ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

let tree: ReactTestRenderer.ReactTestRenderer | null = null;
const signOut = jest.fn().mockResolvedValue(undefined);

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  forgetAppleUser();
  getState.mockResolvedValue(appleAuth.State.AUTHORIZED);
  onRevoked.mockImplementation(() => jest.fn());
  useAuthStore.setState({ status: 'authenticated', signOut });
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
    tree = null;
  });
});

afterAll(() => {
  Platform.OS = 'ios';
});

const mount = async () => {
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Watcher />);
  });
  await flush();
};

describe('the credential', () => {
  test('is only asked about for a session Apple started', async () => {
    await expect(appleCredentialState()).resolves.toBeNull();
    expect(getState).not.toHaveBeenCalled();

    rememberAppleUser('001234.apple-sub');
    getState.mockResolvedValueOnce(appleAuth.State.REVOKED);
    await expect(appleCredentialState()).resolves.toBe('revoked');
    expect(getState).toHaveBeenCalledWith('001234.apple-sub');
  });

  test('is never asked about on Android, which has no such check', async () => {
    Platform.OS = 'android';
    rememberAppleUser('001234.apple-sub');
    await expect(appleCredentialState()).resolves.toBeNull();
  });

  test('a failure to ask is unknown, not revoked', async () => {
    rememberAppleUser('001234.apple-sub');
    getState.mockRejectedValueOnce(new Error('simulator has no Apple ID'));
    await expect(appleCredentialState()).resolves.toBe('unknown');
  });
});

describe('the watch', () => {
  test('signs a revoked Apple session out, saying why', async () => {
    rememberAppleUser('001234.apple-sub');
    getState.mockResolvedValue(appleAuth.State.REVOKED);

    await mount();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut.mock.calls[0][0]).toContain('You stopped using Sign in with Apple for VOKVE');
  });

  test('leaves a session alone when Apple says the credential is fine', async () => {
    rememberAppleUser('001234.apple-sub');
    await mount();
    expect(signOut).not.toHaveBeenCalled();
  });

  test('does not sign out on "not found", which a restored phone can say falsely', async () => {
    rememberAppleUser('001234.apple-sub');
    getState.mockResolvedValue(appleAuth.State.NOT_FOUND);
    await mount();
    expect(signOut).not.toHaveBeenCalled();
  });

  test('ends the session on Apple’s revocation event while the app runs', async () => {
    rememberAppleUser('001234.apple-sub');
    let fire: () => void = () => {};
    onRevoked.mockImplementation((listener: () => void) => {
      fire = listener;
      return jest.fn();
    });
    await mount();
    expect(signOut).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      fire();
    });

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test('watches nothing while signed out', async () => {
    useAuthStore.setState({ status: 'signed_out' });
    rememberAppleUser('001234.apple-sub');
    getState.mockResolvedValue(appleAuth.State.REVOKED);

    await mount();

    expect(getState).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});

test('the remembered id survives only as long as it is set', () => {
  rememberAppleUser('001234.apple-sub');
  expect(rememberedAppleUser()).toBe('001234.apple-sub');
  forgetAppleUser();
  expect(rememberedAppleUser()).toBeNull();
});
