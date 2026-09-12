/**
 * @format
 */

import {
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
    expect(formatHeight(180, 'imperial')).toBe("5'11\"");
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
    expect(formatCompactNumber(1_250_000)).toBe('1.3M');
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
