/**
 * @format
 */

// The store talks to the wallet endpoints on sync; the network is not under
// test here, so the API layer is replaced wholesale and each sync test says
// what the server answers.
jest.mock('../src/services/api/endpoints', () => ({
  walletApi: {
    get: jest.fn(),
    transactions: jest.fn(),
    earnRules: jest.fn(),
  },
}));

import { useCoinsStore, WALLET_STALE_AFTER_MS } from '../src/stores/coinsStore';

beforeEach(() => {
  useCoinsStore.setState({
    balance: 500,
    lifetimeEarned: 500,
    transactions: [],
  });
});

test('earning credits the balance and the lifetime total together', () => {
  useCoinsStore.getState().earn(100, 'Push Day completed', 'workout');

  const { balance, lifetimeEarned, transactions } = useCoinsStore.getState();
  expect(balance).toBe(600);
  expect(lifetimeEarned).toBe(600);
  expect(transactions[0]).toMatchObject({ amount: 100, source: 'workout' });
});

test('spending leaves the lifetime total alone', () => {
  // The wallet shows "earned" and "spent" side by side; a lifetime total that
  // fell when coins were spent would make the pair contradict each other.
  const spent = useCoinsStore.getState().spend(200, 'vokve Shaker');

  expect(spent).toBe(true);
  expect(useCoinsStore.getState().balance).toBe(300);
  expect(useCoinsStore.getState().lifetimeEarned).toBe(500);
});

test('a spend is recorded as a negative amount', () => {
  useCoinsStore.getState().spend(200, 'vokve Shaker');

  expect(useCoinsStore.getState().transactions[0]).toMatchObject({
    amount: -200,
    source: 'purchase',
  });
});

test('spending more than the balance changes nothing and reports failure', () => {
  // The screen needs the answer to tell the user why nothing happened, which
  // is why this is a returned boolean rather than a thrown error.
  const spent = useCoinsStore.getState().spend(900, 'One Month of Pro');

  expect(spent).toBe(false);
  expect(useCoinsStore.getState().balance).toBe(500);
  expect(useCoinsStore.getState().transactions).toHaveLength(0);
});

test('spending the whole balance is allowed', () => {
  expect(useCoinsStore.getState().spend(500, 'Plan Review Call')).toBe(true);
  expect(useCoinsStore.getState().balance).toBe(0);
});

test('the seeded ledger adds up to the seeded balance', () => {
  // The wallet must never show a balance its own history cannot explain.
  useCoinsStore.getState().reset();

  const { balance, lifetimeEarned, transactions } = useCoinsStore.getState();
  const sum = transactions.reduce((total, entry) => total + entry.amount, 0);
  const credits = transactions
    .filter(entry => entry.amount > 0)
    .reduce((total, entry) => total + entry.amount, 0);

  expect(balance).toBe(sum);
  expect(lifetimeEarned).toBe(credits);
});

describe('syncing with the server', () => {
  const { walletApi } = jest.requireMock('../src/services/api/endpoints') as {
    walletApi: {
      get: jest.Mock;
      transactions: jest.Mock;
    };
  };

  const wallet = {
    balance: 1_200,
    pending: 23.75,
    lifetimeEarned: 4_000,
    expiresAt: '2026-12-25T00:00:00.000Z',
    expiryDaysLeft: 42,
    expiryWindowDays: 60,
    expiryWarnDays: [10, 2],
    monthSummary: { earned: 900, spent: 300, net: 600 },
    dailyCap: 300,
    earnedToday: 60,
    remainingToday: 240,
  };

  beforeEach(() => {
    useCoinsStore.getState().reset();
    walletApi.get.mockReset();
    walletApi.transactions.mockReset();
  });

  test("the server's figures replace the seeded ones, month summary and countdown included", async () => {
    walletApi.get.mockResolvedValue(wallet);
    walletApi.transactions.mockResolvedValue({
      data: [
        {
          id: 's1',
          title: 'Walked',
          source: 'steps',
          amount: 5,
          createdAt: new Date().toISOString(),
        },
      ],
      nextCursor: null,
    });

    await useCoinsStore.getState().hydrateFromServer();

    const state = useCoinsStore.getState();
    expect(state).toMatchObject({
      balance: 1_200,
      pending: 23.75,
      lifetimeEarned: 4_000,
      expiryDaysLeft: 42,
      expiresAt: '2026-12-25T00:00:00.000Z',
      expiryWindowDays: 60,
      expiryWarnDays: [10, 2],
      monthSummary: { earned: 900, spent: 300, net: 600 },
      isSyncing: false,
      syncError: null,
    });
    expect(state.transactions).toHaveLength(1);
    expect(state.syncedAt).not.toBeNull();
    // The wallet's own card only needs the newest fifty rows.
    expect(walletApi.transactions).toHaveBeenCalledWith({ limit: 50 });
  });

  test('a failed sync keeps the cached figures and records why', async () => {
    walletApi.get.mockRejectedValue(new Error('Network Error'));
    walletApi.transactions.mockResolvedValue({ data: [], nextCursor: null });
    const before = useCoinsStore.getState().balance;

    await useCoinsStore.getState().hydrateFromServer();

    const state = useCoinsStore.getState();
    expect(state.balance).toBe(before);
    expect(state.syncedAt).toBeNull();
    expect(state.isSyncing).toBe(false);
    expect(state.syncError).toEqual(expect.any(String));
  });

  test('the next successful sync clears the error', async () => {
    useCoinsStore.setState({ syncError: 'Something went wrong.' });
    walletApi.get.mockResolvedValue(wallet);
    walletApi.transactions.mockResolvedValue({ data: [], nextCursor: null });

    await useCoinsStore.getState().hydrateFromServer();

    expect(useCoinsStore.getState().syncError).toBeNull();
  });

  test('refreshIfStale leaves fresh figures alone and fetches stale ones', async () => {
    walletApi.get.mockResolvedValue(wallet);
    walletApi.transactions.mockResolvedValue({ data: [], nextCursor: null });

    useCoinsStore.setState({ syncedAt: new Date().toISOString() });
    await useCoinsStore.getState().refreshIfStale();
    expect(walletApi.get).not.toHaveBeenCalled();

    useCoinsStore.setState({
      syncedAt: new Date(Date.now() - WALLET_STALE_AFTER_MS - 1).toISOString(),
    });
    await useCoinsStore.getState().refreshIfStale();
    expect(walletApi.get).toHaveBeenCalledTimes(1);
  });

  test('a local credit moves the server month figures with it', () => {
    useCoinsStore.setState({
      monthSummary: { earned: 100, spent: 40, net: 60 },
    });

    useCoinsStore.getState().earn(50, 'Bonus');
    useCoinsStore.getState().spend(10, 'Sticker');

    expect(useCoinsStore.getState().monthSummary).toEqual({
      earned: 150,
      spent: 50,
      net: 100,
    });
  });
});
