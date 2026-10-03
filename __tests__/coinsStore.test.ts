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

test('a new wallet holds nothing until the server says otherwise', () => {
  // Coins are minted on the server only (RULES E6): there is no placeholder
  // balance, and no way on the device to add to one.
  useCoinsStore.getState().reset();

  const state = useCoinsStore.getState();
  expect(state).toMatchObject({
    balance: 0,
    pending: 0,
    lifetimeEarned: 0,
    transactions: [],
    monthSummary: null,
    earnRules: null,
    syncedAt: null,
  });
  expect('earn' in state).toBe(false);
  expect('spend' in state).toBe(false);
});

test('a stored wallet that never synced is dropped; a synced one is kept', () => {
  const migrate = useCoinsStore.persist.getOptions().migrate!;

  expect(migrate({ balance: 18_350, syncedAt: null }, 2)).toMatchObject({
    balance: 0,
    transactions: [],
    syncedAt: null,
  });
  const synced = { balance: 42, syncedAt: '2026-10-01T10:00:00.000Z' };
  expect(migrate(synced, 2)).toEqual(synced);
});

describe('syncing with the server', () => {
  const { walletApi } = jest.requireMock('../src/services/api/endpoints') as {
    walletApi: {
      get: jest.Mock;
      transactions: jest.Mock;
      earnRules: jest.Mock;
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

  const rules = [
    { source: 'steps', title: 'Walk', detail: 'Per 100 verified steps', reward: 0.095 },
    { source: 'workout', title: 'Finish a workout', detail: 'Any logged session', reward: 100 },
  ];

  beforeEach(() => {
    useCoinsStore.getState().reset();
    walletApi.get.mockReset();
    walletApi.transactions.mockReset();
    walletApi.earnRules.mockReset();
    walletApi.earnRules.mockResolvedValue(rules);
  });

  test("the server's figures replace the placeholders, month summary and countdown included", async () => {
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
    // The rate card is the server's, never the app's (RULES E14).
    expect(state.earnRules).toEqual(rules);
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
});
