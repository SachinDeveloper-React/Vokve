/**
 * The mock backend is what the whole app runs on until a real one exists, so
 * a hole in it looks exactly like a bug in a screen. These checks pin down the
 * contract the screens were built against: the code that works, the ones that
 * do not, and the failures a developer needs to be able to reach on purpose.
 *
 * @format
 */

// Latency is what makes spinners visible in the app and slow in a test suite.
jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    mockLatencyMs: 0,
  },
}));

import { config } from '../src/constants/config';
import { ApiError } from '../src/services/api/errors';
import { shouldUseMockApi } from '../src/services/api/endpoints';
import {
  MOCK_RULES,
  mockActivityApi,
  mockAuthApi,
  mockUserApi,
  mockWalletApi,
  mockWorkoutApi,
} from '../src/services/api/mockApi';
import { seedCoinTransactions } from '../src/constants/seedData';
import type { SignUpPayload } from '../src/types/forms';

const PAYLOAD: SignUpPayload = {
  email: 'sachin@example.com',
  phone: '+919876543210',
  password: 'longenough1',
  dateOfBirth: '1995-04-17',
  gender: 'male',
};

/** Signing out is the mock's own reset — it clears every bit of module state. */
beforeEach(async () => {
  await mockAuthApi.signOut();
});

const expectApiError = async (
  run: () => Promise<unknown>,
  kind: ApiError['kind'],
) => {
  await expect(run()).rejects.toBeInstanceOf(ApiError);
  await run().catch(error => {
    expect((error as ApiError).kind).toBe(kind);
  });
};

describe('the mock switch', () => {
  // The backend exists now (vokve-backend/), so the default is the real API.
  test('is off now that there is a backend', () => {
    expect(shouldUseMockApi()).toBe(false);
  });

  test('turns on from the config flag alone', () => {
    const mutable = config as { useMockApi: boolean };
    mutable.useMockApi = true;
    try {
      expect(shouldUseMockApi()).toBe(true);
    } finally {
      mutable.useMockApi = false;
    }
  });
});

describe('mock sign-up and verification', () => {
  test('returns a challenge rather than a session', async () => {
    const challenge = await mockAuthApi.signUp(PAYLOAD);

    // The code goes to the email while there is no SMS provider, as on the
    // server (`otp.signupChannel`), so the phone field is empty and the
    // masked target is the address.
    expect(challenge.channel).toBe('email');
    expect(challenge.phone).toBe('');
    expect(challenge.target).toMatch(/^.•••@/);
    expect(challenge.codeLength).toBe(MOCK_RULES.otp.length);
    expect(challenge.expiresInSeconds).toBeGreaterThan(0);
    expect(challenge.resendInSeconds).toBeGreaterThan(0);
    // No tokens anywhere: the number is not proven yet.
    expect(challenge).not.toHaveProperty('tokens');
  });

  test('issues a session once the right code comes back', async () => {
    const challenge = await mockAuthApi.signUp(PAYLOAD);
    const { user, tokens } = await mockAuthApi.verifyOtp(
      challenge.verificationId,
      MOCK_RULES.otp,
    );

    expect(tokens.accessToken).toBeTruthy();
    expect(user.email).toBe(PAYLOAD.email);
    expect(user.phone).toBe(PAYLOAD.phone);
    expect(user.gender).toBe('male');
    // Sign-up collects no name, so one has to be derived rather than left blank.
    expect(user.name).toBeTruthy();
  });

  test('rejects any code that is not the magic one', async () => {
    const challenge = await mockAuthApi.signUp(PAYLOAD);

    await expectApiError(
      () => mockAuthApi.verifyOtp(challenge.verificationId, '000000'),
      'validation',
    );
  });

  test('rejects a verification id it has never seen', async () => {
    await expectApiError(
      () => mockAuthApi.verifyOtp('ver_nope', MOCK_RULES.otp),
      'not_found',
    );
  });

  test('will not verify the same sign-up twice', async () => {
    const challenge = await mockAuthApi.signUp(PAYLOAD);
    await mockAuthApi.verifyOtp(challenge.verificationId, MOCK_RULES.otp);

    await expectApiError(
      () => mockAuthApi.verifyOtp(challenge.verificationId, MOCK_RULES.otp),
      'not_found',
    );
  });

  test('a resend restarts both clocks on the same sign-up', async () => {
    const first = await mockAuthApi.signUp(PAYLOAD);
    const second = await mockAuthApi.resendOtp(first.verificationId);

    expect(second.verificationId).toBe(first.verificationId);
    expect(second.resendInSeconds).toBeGreaterThan(0);
    expect(second.expiresInSeconds).toBeGreaterThan(0);
  });

  test('offers a way to reach the "already registered" path on purpose', async () => {
    await expectApiError(
      () =>
        mockAuthApi.signUp({
          ...PAYLOAD,
          email: `${MOCK_RULES.takenMarker}@example.com`,
        }),
      'validation',
    );
  });
});

describe('mock onboarding', () => {
  test('a fresh sign-up arrives with no profile and no stamp', async () => {
    const challenge = await mockAuthApi.signUp(PAYLOAD);
    const { user } = await mockAuthApi.verifyOtp(
      challenge.verificationId,
      MOCK_RULES.otp,
    );

    // Seeding these would skip the onboarding step entirely.
    expect(user.profileCompletedAt).toBeNull();
    expect(user.heightCm).toBeNull();
    expect(user.weightKg).toBeNull();
  });

  test('completing the profile stamps it and stores canonical units', async () => {
    const challenge = await mockAuthApi.signUp(PAYLOAD);
    await mockAuthApi.verifyOtp(challenge.verificationId, MOCK_RULES.otp);

    const user = await mockUserApi.completeProfile({
      name: 'Rahul Sharma',
      heightCm: 175,
      weightKg: 68,
      units: 'metric',
    });

    expect(user.name).toBe('Rahul Sharma');
    expect(user.heightCm).toBe(175);
    expect(user.weightKg).toBe(68);
    expect(user.profileCompletedAt).not.toBeNull();
  });

  test('refuses to complete a profile with no session behind it', async () => {
    await expectApiError(
      () =>
        mockUserApi.completeProfile({
          name: 'Rahul Sharma',
          heightCm: 175,
          weightKg: 68,
          units: 'metric',
        }),
      'unauthorized',
    );
  });
});

describe('mock sign-in', () => {
  test('accepts any credentials, so the app is never locked out', async () => {
    const { tokens } = await mockAuthApi.signIn('anyone@example.com', 'secret');
    expect(tokens.accessToken).toBeTruthy();
  });

  test('offers a way to reach the rejection path on purpose', async () => {
    await expectApiError(
      () => mockAuthApi.signIn('a@b.com', MOCK_RULES.rejectedPassword),
      'unauthorized',
    );
  });
});

describe('mock session restore', () => {
  test('fails the way a dead token does, before anyone has signed in', async () => {
    await expectApiError(() => mockUserApi.me(), 'unauthorized');
  });

  test('returns the signed-in user afterwards', async () => {
    await mockAuthApi.signIn('a@b.com', 'secret');
    await expect(mockUserApi.me()).resolves.toHaveProperty('id');
  });
});

describe('mock app data', () => {
  test('serves the workout templates the screens already read', async () => {
    await expect(mockWorkoutApi.templates()).resolves.not.toHaveLength(0);
  });

  test('starts a new account with no history, so the empty state is reachable', async () => {
    await expect(mockWorkoutApi.history()).resolves.toEqual({ data: [], nextCursor: null });
  });

  test('returns a full week of activity, dated and consistent', async () => {
    const week = await mockActivityApi.weekly();

    expect(week).toHaveLength(7);
    for (const day of week) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.steps).toBeGreaterThan(0);
      expect(day.caloriesBurned).toBeGreaterThan(0);
    }
    // Last entry is today, which is what the Today screen assumes.
    expect(week[6].date).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('the wallet ledger', () => {
  test('pages with a cursor the way the server does', async () => {
    const first = await mockWalletApi.transactions({ limit: 4 });
    expect(first.data).toHaveLength(4);
    expect(first.nextCursor).toBe(first.data[3].id);

    const second = await mockWalletApi.transactions({
      limit: 4,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.data[0].id).toBe(seedCoinTransactions[4].id);

    // Walk to the end: the last page says there is no more.
    const third = await mockWalletApi.transactions({
      limit: 4,
      cursor: second.nextCursor ?? undefined,
    });
    expect(third.nextCursor).toBeNull();
    expect(first.data.length + second.data.length + third.data.length).toBe(
      seedCoinTransactions.length,
    );
  });

  test('filters to one source and pages inside it', async () => {
    const page = await mockWalletApi.transactions({ source: 'workout', limit: 2 });
    expect(page.data.every(row => row.source === 'workout')).toBe(true);
    expect(page.data).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();

    const rest = await mockWalletApi.transactions({
      source: 'workout',
      cursor: page.nextCursor ?? undefined,
    });
    expect(rest.data.every(row => row.source === 'workout')).toBe(true);
    expect(rest.nextCursor).toBeNull();
  });

  test("the month summary is this calendar month's rows, not the lifetime", async () => {
    const wallet = await mockWalletApi.get();
    const now = new Date();
    const thisMonth = seedCoinTransactions.filter(row => {
      const at = new Date(row.createdAt);
      return at.getMonth() === now.getMonth() && at.getFullYear() === now.getFullYear();
    });
    const earned = thisMonth.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const spent = thisMonth.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0);

    expect(wallet.monthSummary).toEqual({ earned, spent, net: earned - spent });
  });
});
