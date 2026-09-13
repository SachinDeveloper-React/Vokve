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
    tint: 'destructive',
    emoji: '❤️',
  },
  blood_pressure: {
    label: 'Blood Pressure',
    unit: 'mmHg',
    tint: 'brandAccent',
    emoji: '🩸',
  },
  bmi: { label: 'BMI', unit: '', tint: 'avatarPurple', emoji: '📊' },
  weight: { label: 'Weight', unit: 'kg', tint: 'success', emoji: '⚖️' },
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
    case 'blood_pressure': {
      const diastolic = reading.secondary ?? 0;
      if (reading.value >= 130 || diastolic >= 80) return 'high';
      if (reading.value < 90 || diastolic < 60) return 'low';
      return 'normal';
    }
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
