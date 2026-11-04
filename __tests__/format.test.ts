/**
 * @format
 */

import {
  formatCoinBalance,
  formatCoins,
  formatCountdown,
  formatPhoneNumber,
  formatCompactNumber,
  formatDuration,
  formatHeight,
  formatWeight,
} from '../src/utils/format';

describe('formatWeight', () => {
  test('keeps kilograms as entered', () => {
    expect(formatWeight(100, 'metric')).toBe('100 kg');
    expect(formatWeight(72.5, 'metric')).toBe('72.5 kg');
  });

  test('converts to pounds for imperial users', () => {
    expect(formatWeight(100, 'imperial')).toBe('220 lb');
  });
});

describe('formatHeight', () => {
  test('renders feet and inches for imperial users', () => {
    expect(formatHeight(180, 'imperial')).toBe('5\'11"');
  });

  test('rounds centimetres for metric users', () => {
    expect(formatHeight(180.4, 'metric')).toBe('180 cm');
  });
});

describe('formatDuration', () => {
  test('uses m:ss below an hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
  });

  test('adds an hours segment once it is needed', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  test('never renders a negative time', () => {
    expect(formatDuration(-30)).toBe('0:00');
  });
});

describe('formatCompactNumber', () => {
  test('abbreviates thousands and millions', () => {
    expect(formatCompactNumber(950)).toBe('950');
    expect(formatCompactNumber(4520)).toBe('4.5k');
    expect(formatCompactNumber(1_250_000)).toBe('1.2M');
  });

  test('floors, so it never claims a figure that was not reached', () => {
    // 2,999 written as "3.0k" is a thousand nobody counted; on a coin total
    // it is a balance nobody has.
    expect(formatCompactNumber(2_999)).toBe('2.9k');
    expect(formatCompactNumber(999_999)).toBe('999.9k');
  });

  test('a whole thousand drops the decimal it has nothing to say with', () => {
    expect(formatCompactNumber(2_000)).toBe('2k');
    expect(formatCompactNumber(12_000)).toBe('12k');
    expect(formatCompactNumber(1_000_000)).toBe('1M');
  });
});

describe('formatCoinBalance', () => {
  test('writes a real balance in whole coins, exactly', () => {
    // Four and five figures are what members actually hold, and a price is
    // quoted to the coin — so the balance it is read against stays exact.
    expect(formatCoinBalance(6_362.09)).toBe('6,362');
    expect(formatCoinBalance(2_450)).toBe('2,450');
    expect(formatCoinBalance(99_999.9)).toBe('99,999');
  });

  test('floors the fraction rather than rounding it up', () => {
    // The wallet cannot pay out what the card rounded up to.
    expect(formatCoinBalance(0.9)).toBe('0');
    expect(formatCoinBalance(1_999.99)).toBe('1,999');
  });

  test('compacts only past the threshold the rest of the app uses', () => {
    expect(formatCoinBalance(100_000)).toBe('100k');
    expect(formatCoinBalance(1_234_567.89)).toBe('1.2M');
  });

  test('leaves every other coin figure exact', () => {
    // A price, a ledger row, "you need 1,250 more coins" — all unchanged.
    expect(formatCoins(6_362.09)).toBe('6,362.09');
    expect(formatCoins(1_250)).toBe('1,250');
  });
});

describe('formatCountdown', () => {
  test('pads the minutes so the clock does not reflow as it ticks', () => {
    expect(formatCountdown(105)).toBe('01:45');
    expect(formatCountdown(27)).toBe('00:27');
    expect(formatCountdown(600)).toBe('10:00');
  });

  test('bottoms out at zero rather than going negative', () => {
    expect(formatCountdown(-5)).toBe('00:00');
  });
});

describe('formatPhoneNumber', () => {
  test('splits the dial code off and groups the rest', () => {
    expect(formatPhoneNumber('+919876543210')).toBe('+91 98765 43210');
  });

  test('prefers the longest matching dial code', () => {
    // `+1` also prefixes this, and matching it first would misgroup the number.
    expect(formatPhoneNumber('+9779812345678')).toContain('+977 ');
  });

  test('returns an unrecognised number untouched rather than mangling it', () => {
    expect(formatPhoneNumber('+99912345')).toBe('+99912345');
  });
});
