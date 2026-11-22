import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real Firebase phone verifier (RULES O14), with firebase-admin mocked
 * at its seam. `phoneVerify.test.ts` replaces the verifier wholesale, so
 * nothing there would notice if a token from some other kind of Firebase
 * sign-in — one that proves no number — were let through, or an old one.
 */

const verifyIdToken = vi.fn();
const deleteUser = vi.fn();
let configured = true;

vi.mock('../src/lib/firebaseAdmin.js', () => ({
  firebaseAdminApp: async () =>
    configured ? { app: { auth: () => ({ verifyIdToken, deleteUser }) }, projectId: 'vokve-test' } : null,
}));

const { forgetFirebaseUser, verifyFirebasePhoneToken } = await import('../src/lib/firebasePhone.js');

const now = () => Math.floor(Date.now() / 1000);
const decoded = (over: Record<string, unknown> = {}) => ({
  uid: 'fb-uid-1',
  phone_number: '+919812345678',
  auth_time: now() - 30,
  firebase: { sign_in_provider: 'phone' },
  ...over,
});

beforeEach(() => {
  configured = true;
  verifyIdToken.mockReset();
  deleteUser.mockReset();
  verifyIdToken.mockResolvedValue(decoded());
});

describe('a phone confirmation from Firebase', () => {
  it('yields the number Firebase proved', async () => {
    await expect(verifyFirebasePhoneToken('tok')).resolves.toEqual({
      phone: '+919812345678',
      firebaseUid: 'fb-uid-1',
    });
  });

  it('is refused when it came from another kind of Firebase sign-in', async () => {
    verifyIdToken.mockResolvedValueOnce(decoded({ firebase: { sign_in_provider: 'password' } }));
    await expect(verifyFirebasePhoneToken('tok')).rejects.toMatchObject({ status: 401, code: 'PHONE_TOKEN_INVALID' });
  });

  it('is refused when it carries no number', async () => {
    verifyIdToken.mockResolvedValueOnce(decoded({ phone_number: undefined }));
    await expect(verifyFirebasePhoneToken('tok')).rejects.toMatchObject({ status: 401 });
  });

  it('is refused when the code was confirmed too long ago', async () => {
    verifyIdToken.mockResolvedValueOnce(decoded({ auth_time: now() - 3600 }));
    await expect(verifyFirebasePhoneToken('tok')).rejects.toMatchObject({ status: 401, code: 'PHONE_TOKEN_STALE' });
  });

  it('is refused when Firebase will not vouch for it', async () => {
    verifyIdToken.mockRejectedValueOnce(new Error('auth/argument-error'));
    await expect(verifyFirebasePhoneToken('tok')).rejects.toMatchObject({ status: 401, code: 'PHONE_TOKEN_INVALID' });
  });

  it('answers 503 on a server with no Firebase credentials', async () => {
    configured = false;
    await expect(verifyFirebasePhoneToken('tok')).rejects.toMatchObject({ status: 503 });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});

describe('forgetting the Firebase user', () => {
  it('deletes it, and never throws when Firebase will not', async () => {
    await forgetFirebaseUser('fb-uid-1');
    expect(deleteUser).toHaveBeenCalledWith('fb-uid-1');

    deleteUser.mockRejectedValueOnce(new Error('down'));
    await expect(forgetFirebaseUser('fb-uid-2')).resolves.toBeUndefined();
  });
});
