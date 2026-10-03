/**
 * The streak store is a cache of the server's streak (RULES §S): the
 * arithmetic over days now lives on the server, with its golden tests. The
 * checks here are about the seam — that nothing is invented before the first
 * answer, that a placeholder streak stored by an older build is dropped, and
 * that a freeze and a restore take the server's answer, or its refusal,
 * without charging or protecting anything on the device.
 *
 * @format
 */

jest.mock('../src/services/api/endpoints', () => ({
  streakApi: { get: jest.fn(), freeze: jest.fn(), restore: jest.fn() },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
}));

import { ApiError } from '../src/services/api/errors';
import { useCoinsStore } from '../src/stores/coinsStore';
import {
  STREAK_STALE_AFTER_MS,
  useStreakStore,
} from '../src/stores/streakStore';
import type { StreakSummary } from '../src/types/models';

const { streakApi, walletApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  streakApi: { get: jest.Mock; freeze: jest.Mock; restore: jest.Mock };
  walletApi: { get: jest.Mock; transactions: jest.Mock; earnRules: jest.Mock };
};

const summary = (over: Partial<StreakSummary> = {}): StreakSummary => ({
  today: '2026-10-02',
  currentStreak: 3,
  longestStreak: { length: 3, start: '2026-09-30', end: '2026-10-02' },
  completedDays: ['2026-09-30', '2026-10-01', '2026-10-02'],
  protectedDays: [],
  freezesAvailable: 1,
  maxFreezes: 3,
  todayCovered: true,
  todayFrozen: false,
  canRestore: false,
  restoreGap: [],
  restoreCostCoins: 50,
  restoreWindowDays: 7,
  milestones: [{ days: 7, coins: 50, achieved: false, paid: false }],
  nextMilestone: { days: 7, coins: 50, achieved: false, paid: false },
  howToEarn: 'Finish a workout or walk 10,000 steps in a day.',
  ...over,
});

beforeEach(() => {
  useStreakStore.getState().reset();
  streakApi.get.mockReset();
  streakApi.freeze.mockReset();
  streakApi.restore.mockReset();
  walletApi.get.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.transactions.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.earnRules.mockReset().mockRejectedValue(new Error('offline'));
});

test('a new store holds no streak until the server has said one', () => {
  const state = useStreakStore.getState();
  expect(state.summary).toBeNull();
  expect(state.syncedAt).toBeNull();
});

test('a streak stored by an older build — the device’s own day lists — is dropped', () => {
  const migrate = useStreakStore.persist.getOptions().migrate!;
  expect(
    migrate({ completedDays: ['2026-09-01'], freezesAvailable: 1 }, 1),
  ).toEqual({ summary: null, syncedAt: null });
});

test("a sync takes the server's streak whole", async () => {
  streakApi.get.mockResolvedValue(summary());

  await useStreakStore.getState().hydrateFromServer();

  const state = useStreakStore.getState();
  expect(state.summary).toEqual(summary());
  expect(state.syncedAt).not.toBeNull();
  expect(state.syncError).toBeNull();
});

test('a failed sync keeps the cached streak and says why', async () => {
  useStreakStore.setState({ summary: summary() });
  streakApi.get.mockRejectedValue(new Error('Network Error'));

  await useStreakStore.getState().hydrateFromServer();

  const state = useStreakStore.getState();
  expect(state.summary).toEqual(summary());
  expect(state.syncError).toEqual(expect.any(String));
  expect(state.isSyncing).toBe(false);
});

test('refreshIfStale leaves a fresh streak alone and fetches a stale one', async () => {
  streakApi.get.mockResolvedValue(summary());

  useStreakStore.setState({ syncedAt: new Date().toISOString() });
  await useStreakStore.getState().refreshIfStale();
  expect(streakApi.get).not.toHaveBeenCalled();

  useStreakStore.setState({
    syncedAt: new Date(Date.now() - STREAK_STALE_AFTER_MS - 1).toISOString(),
  });
  await useStreakStore.getState().refreshIfStale();
  expect(streakApi.get).toHaveBeenCalledTimes(1);
});

test("a freeze takes the server's answer, keyed so a retry cannot spend two", async () => {
  useStreakStore.setState({ summary: summary({ todayCovered: false }) });
  const frozen = summary({ todayFrozen: true, freezesAvailable: 0 });
  streakApi.freeze.mockResolvedValue(frozen);

  const result = await useStreakStore.getState().freezeToday();

  expect(result).toEqual({ ok: true });
  expect(streakApi.freeze).toHaveBeenCalledWith({
    idempotencyKey: expect.any(String),
  });
  expect(useStreakStore.getState().summary).toEqual(frozen);
  expect(useStreakStore.getState().pendingAction).toBeNull();
});

test('a refused freeze reports the code and message, and asks again', async () => {
  useStreakStore.setState({ summary: summary() });
  streakApi.freeze.mockRejectedValue(
    new ApiError(
      'unknown',
      'Today already counts — save the freeze for a rest day.',
      409,
      null,
      'STREAK_ALREADY_COVERED',
    ),
  );
  streakApi.get.mockResolvedValue(summary());

  const result = await useStreakStore.getState().freezeToday();

  expect(result).toEqual({
    ok: false,
    code: 'STREAK_ALREADY_COVERED',
    message: 'Today already counts — save the freeze for a rest day.',
  });
  expect(streakApi.get).toHaveBeenCalledTimes(1);
});

test("a restore takes the streak and the wallet's balance from the server", async () => {
  useStreakStore.setState({
    summary: summary({ currentStreak: 0, canRestore: true }),
  });
  useCoinsStore.setState({ balance: 1000 });
  const restored = summary({ protectedDays: ['2026-09-29'] });
  streakApi.restore.mockResolvedValue({ streak: restored, balance: 950 });

  const result = await useStreakStore.getState().restore();

  expect(result).toEqual({ ok: true });
  expect(useStreakStore.getState().summary).toEqual(restored);
  expect(useCoinsStore.getState().balance).toBe(950);
  // The ledger row follows on the wallet's own sync.
  expect(walletApi.get).toHaveBeenCalled();
});

test('a restore the server refuses charges nothing on the device', async () => {
  useStreakStore.setState({
    summary: summary({ currentStreak: 0, canRestore: true }),
  });
  useCoinsStore.setState({ balance: 20 });
  streakApi.restore.mockRejectedValue(
    new ApiError(
      'validation',
      'You need 30 more coins for this.',
      422,
      { required: 50, balance: 20 },
      'INSUFFICIENT_COINS',
    ),
  );
  streakApi.get.mockResolvedValue(summary({ currentStreak: 0 }));

  const result = await useStreakStore.getState().restore();

  expect(result).toMatchObject({ ok: false, code: 'INSUFFICIENT_COINS' });
  expect(useCoinsStore.getState().balance).toBe(20);
});

test('a second tap while one is in flight is not sent', async () => {
  useStreakStore.setState({ summary: summary({ todayCovered: false }) });
  streakApi.freeze.mockReturnValue(new Promise(() => {}));

  useStreakStore.getState().freezeToday();
  const second = await useStreakStore.getState().freezeToday();

  expect(second).toMatchObject({ ok: false, code: 'IN_PROGRESS' });
  expect(streakApi.freeze).toHaveBeenCalledTimes(1);
});
