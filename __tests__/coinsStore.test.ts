/**
 * @format
 */

import { useCoinsStore } from '../src/stores/coinsStore';

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
