/**
 * The Firebase half of phone verification (RULES O14): what each answer from
 * Firebase becomes, and that no Firebase session outlives the token.
 *
 * @format
 */

import * as firebaseAuth from '@react-native-firebase/auth';
import {
  abandon,
  confirmCode,
  sendCode,
} from '../src/services/phoneVerification';

const firebase = firebaseAuth as unknown as {
  getAuth: () => { currentUser: unknown };
  signInWithPhoneNumber: jest.Mock;
  signOut: jest.Mock;
  __setUser: (user: { uid: string; phoneNumber: string } | null) => void;
};

const firebaseError = (code: string) => Object.assign(new Error(code), { code });

beforeEach(async () => {
  await abandon();
  firebase.__setUser(null);
  firebase.signInWithPhoneNumber.mockClear();
  firebase.signOut.mockClear();
});

test('a sent code, then the right one, gives the token and signs Firebase out', async () => {
  await expect(sendCode('+919812345678')).resolves.toEqual({ kind: 'sent' });
  await expect(confirmCode('123456')).resolves.toEqual({
    kind: 'verified',
    idToken: 'firebase-id-token:+919812345678',
  });
  expect(firebase.getAuth().currentUser).toBeNull();
});

test('a wrong code says so and keeps the attempt, so the member can type it again', async () => {
  firebase.signInWithPhoneNumber.mockResolvedValueOnce({
    verificationId: 'v',
    confirm: jest
      .fn()
      .mockRejectedValueOnce(firebaseError('auth/invalid-verification-code'))
      .mockResolvedValueOnce({ user: { uid: 'u', phoneNumber: '+919812345678' } }),
  });
  await sendCode('+919812345678');

  await expect(confirmCode('000000')).resolves.toEqual({
    kind: 'failed',
    message: 'That code is not right. Check it and try again.',
    codeRejected: true,
  });
  await expect(confirmCode('123456')).resolves.toMatchObject({ kind: 'verified' });
});

test('a build Firebase does not know (no SHA, provider off) says it is not set up', async () => {
  firebase.signInWithPhoneNumber.mockRejectedValueOnce(firebaseError('auth/app-not-authorized'));
  await expect(sendCode('+919812345678')).resolves.toEqual({
    kind: 'failed',
    message: 'Phone verification is not set up for this build of the app.',
  });
});

test('too many SMS is its own message', async () => {
  firebase.signInWithPhoneNumber.mockRejectedValueOnce(firebaseError('auth/too-many-requests'));
  await expect(sendCode('+919812345678')).resolves.toMatchObject({
    message: expect.stringContaining('Too many codes'),
  });
});

test('a session left from an earlier attempt is not read as this number proved', async () => {
  firebase.__setUser({ uid: 'old', phoneNumber: '+919800000000' });
  await expect(sendCode('+919812345678')).resolves.toEqual({ kind: 'sent' });
  expect(firebase.signOut).toHaveBeenCalled();
});
