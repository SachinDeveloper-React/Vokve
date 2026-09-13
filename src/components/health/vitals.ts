import type { ThemeColors } from '../../constants/colors';
import type { VitalKind, VitalReading } from '../../types/models';

export type VitalTint = Extract<
  keyof ThemeColors,
  'destructive' | 'brandAccent' | 'avatarPurple' | 'success'
>;

interface VitalPresentation {
  label: string;
  /** Written after the figure — "bpm", "kg". Empty where the number stands alone. */
  unit: string;
  /** The unit as a screen reader should say it — "beats per minute". */
  spokenUnit: string;
  tint: VitalTint;
  emoji: string;
}

/**
 * How each vital reads and looks, declared once.
 *
 * Exhaustive by type: adding a `VitalKind` without an entry here is a compile
 * error rather than a tile that renders with no unit and no colour.
 */
export const VITAL_STYLE: Record<VitalKind, VitalPresentation> = {
  heart_rate: {
    label: 'Heart Rate',
    unit: 'bpm',
    spokenUnit: 'beats per minute',
    tint: 'destructive',
    emoji: '❤️',
  },
  blood_pressure: {
    label: 'Blood Pressure',
    unit: 'mmHg',
    spokenUnit: 'millimetres of mercury',
    tint: 'brandAccent',
    emoji: '🩸',
  },
  bmi: {
    label: 'BMI',
    unit: '',
    spokenUnit: '',
    tint: 'avatarPurple',
    emoji: '📊',
  },
  weight: {
    label: 'Weight',
    unit: 'kg',
    spokenUnit: 'kilograms',
    tint: 'success',
    emoji: '⚖️',
  },
};

/** The order the tiles are laid out in, which the history follows too. */
export const VITAL_ORDER: readonly VitalKind[] = [
  'heart_rate',
  'blood_pressure',
  'bmi',
  'weight',
];

export type VitalStatus = 'low' | 'normal' | 'elevated' | 'high' | 'logged';

interface StatusPresentation {
  label: string;
  tint: Extract<keyof ThemeColors, 'success' | 'warning' | 'destructive'>;
}

export const STATUS_STYLE: Record<VitalStatus, StatusPresentation> = {
  low: { label: 'Low', tint: 'warning' },
  normal: { label: 'Normal', tint: 'success' },
  elevated: { label: 'Elevated', tint: 'warning' },
  high: { label: 'High', tint: 'destructive' },
  logged: { label: 'Updated', tint: 'success' },
};

export type HeartBandTint = Extract<
  keyof ThemeColors,
  'primary' | 'success' | 'warning' | 'destructive'
>;

export interface HeartBand {
  /** The scale's label — "60 - 100". */
  range: string;
  label: string;
  tint: HeartBandTint;
  /** Beats per minute this band starts at, inclusive. */
  from: number;
  /** The verdict a reading in this band carries everywhere in the app. */
  status: VitalStatus;
}

/**
 * The resting heart rate bands, in the order the scale runs.
 *
 * They live here rather than with the heart rate screen because they are the
 * app's answer to "is this pulse normal", and the checkup's tile asks that
 * question too. Two sets of bands would have one screen calling 118 elevated
 * while the screen behind it called the same reading high.
 */
export const HEART_BANDS: readonly HeartBand[] = [
  { range: '< 60', label: 'Low', tint: 'primary', from: 0, status: 'low' },
  {
    range: '60 - 100',
    label: 'Normal',
    tint: 'success',
    from: 60,
    status: 'normal',
  },
  {
    range: '101 - 120',
    label: 'Elevated',
    tint: 'warning',
    from: 101,
    status: 'elevated',
  },
  {
    range: '> 120',
    label: 'High',
    tint: 'destructive',
    from: 121,
    status: 'high',
  },
];

export interface PressureBand {
  label: string;
  tint: HeartBandTint;
  status: VitalStatus;
}

/**
 * Which blood pressure band a reading falls in.
 *
 * The standard adult categories: normal under 120 over 80, elevated when the
 * top number alone creeps into the 120s, high once either number reaches 130
 * or 80. Either half can push a reading up a band — a diastolic of 82 is high
 * however ordinary the systolic beside it — which is the case a check on the
 * first number alone gets wrong.
 */
export function pressureBandFor(
  systolic: number,
  diastolic: number,
): PressureBand {
  if (systolic >= 130 || diastolic >= 80) {
    return { label: 'High', tint: 'destructive', status: 'high' };
  }
  if (systolic < 90 || diastolic < 60) {
    return { label: 'Low', tint: 'primary', status: 'low' };
  }
  if (systolic >= 120) {
    return { label: 'Elevated', tint: 'warning', status: 'elevated' };
  }
  return { label: 'Normal', tint: 'success', status: 'normal' };
}

/** The sentence under a blood pressure figure, which follows its band. */
export function pressureMessageFor(
  systolic: number,
  diastolic: number,
): string {
  switch (pressureBandFor(systolic, diastolic).status) {
    case 'low':
      return 'Lower than the usual range. Fine if you feel fine; worth a check if you feel faint.';
    case 'elevated':
      return 'The top number is creeping up. Worth keeping an eye on.';
    case 'high':
      return 'Above the healthy range. If it stays there, speak to a doctor.';
    default:
      return 'Your blood pressure is in a healthy range';
  }
}

/** Which band a reading falls in. Never undefined: the first starts at zero. */
export function bandFor(bpm: number): HeartBand {
  return (
    [...HEART_BANDS].reverse().find(band => bpm >= band.from) ?? HEART_BANDS[0]
  );
}

/** The sentence under the figure, which follows the band it is in. */
export function heartMessageFor(bpm: number): string {
  switch (bandFor(bpm).status) {
    case 'low':
      return 'Lower than the usual resting range. Normal for athletes, worth a check otherwise.';
    case 'elevated':
      return 'Higher than a resting pulse. Rest a few minutes and measure again.';
    case 'high':
      return 'Well above a resting pulse. If you are at rest, speak to a doctor.';
    default:
      return 'Your heart rate is in a healthy range';
  }
}

/**
 * Whether a reading sits in its healthy range.
 *
 * The bands are the ordinary adult reference ranges — a resting pulse from the
 * scale above, a blood pressure under 120 over 80, a BMI of 18.5 to 24.9.
 * Weight has
 * no band at all: what a healthy weight is depends on height, which is exactly
 * what the BMI beside it already accounts for, so a weight reading reports
 * only that it was logged.
 *
 * Derived rather than stored, so a tile can never show a number from one
 * reading beside a verdict from another.
 */
export function statusOf(reading: VitalReading): VitalStatus {
  switch (reading.kind) {
    case 'heart_rate':
      // Straight off the bands the heart rate screen draws, so the tile and
      // that screen cannot put two different words on one reading.
      return bandFor(reading.value).status;
    case 'blood_pressure':
      // Off the same bands the blood pressure screen draws, for the same
      // reason as the heart rate above.
      return pressureBandFor(reading.value, reading.secondary ?? 0).status;
    case 'bmi':
      if (reading.value < 18.5) return 'low';
      return reading.value >= 25 ? 'high' : 'normal';
    default:
      return 'logged';
  }
}

/** The figure as a tile writes it — "118 / 76", "22.4", "65.0". */
export function formatVitalValue(reading: VitalReading): string {
  if (reading.kind === 'blood_pressure') {
    return `${Math.round(reading.value)} / ${Math.round(
      reading.secondary ?? 0,
    )}`;
  }
  if (reading.kind === 'heart_rate') {
    return String(Math.round(reading.value));
  }
  return reading.value.toFixed(1);
}
