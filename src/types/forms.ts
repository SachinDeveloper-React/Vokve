import { z } from 'zod';
import {
  activityLevelSchema,
  fitnessGoalSchema,
  genderSchema,
  unitSystemSchema,
  type Gender,
  type UnitSystem,
} from './models';
import { COUNTRIES, findCountry } from '../constants/countries';

/**
 * Form schemas, separate from the API models in `models.ts`.
 *
 * A form describes what the user types — a password, a confirmation field, a
 * height in whatever unit they prefer. The API model describes what the server
 * stores. Collapsing the two forces the model to carry fields that never leave
 * the device, so they are kept apart and mapped explicitly at submit time.
 */

// Trimmed before it is checked: a pasted address routinely carries a leading
// or trailing space, and rejecting it teaches the user nothing they can act on.
const email = z
  .string()
  .trim()
  .min(1, 'Enter your email address')
  .email('That does not look like an email address');

/**
 * Length plus one letter and one digit — no symbol rule, no upper-case rule.
 *
 * Composition rules past that point push people towards `Password1!` and a
 * sticky note; length is what actually costs an attacker time. The 72-character
 * ceiling is bcrypt's, and a password truncated silently at the hashing step is
 * worse than one rejected at the field.
 */
const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Passwords cannot be longer than 72 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

/** What the phone field holds — a country and the digits typed beside it. */
export const phoneSchema = z.object({
  country: z
    .string()
    .refine(code => COUNTRIES.some(country => country.code === code), {
      message: 'Choose a country',
    }),
  // The dial code is stored apart from the number, so what is validated here
  // is the national part only: long enough to be a real subscriber number,
  // short enough to rule out a pasted account number.
  number: z
    .string()
    .min(1, 'Enter your phone number')
    .regex(/^\d+$/, 'Use digits only')
    .min(7, 'That number looks too short')
    .max(15, 'That number looks too long'),
});
export type PhoneFormValue = z.infer<typeof phoneSchema>;

/**
 * Anything a returning user might type into the single sign-in field.
 *
 * The screen offers one box for an email address or a phone number, so the
 * validator has to accept both. Phone numbers are checked only for shape —
 * an optional country prefix and 7-18 digits, with spaces and dashes allowed
 * because that is how people write them down. Deciding whether a number is
 * real is the server's job; the client's job is to not reject a valid one.
 */
const PHONE_PATTERN = /^\+?\d[\d\s-]{6,17}$/;

const identifier = z
  .string()
  .min(1, 'Enter your email or phone number')
  .refine(
    value => {
      const trimmed = value.trim();
      return (
        z.string().email().safeParse(trimmed).success ||
        PHONE_PATTERN.test(trimmed)
      );
    },
    { message: 'Enter a valid email address or phone number' },
  );

export const signInSchema = z.object({
  identifier,
  password: z.string().min(1, 'Enter your password'),
});
export type SignInValues = z.infer<typeof signInSchema>;

/** The one field forgot-password asks for: the same email-or-phone as sign-in. */
export const forgotPasswordSchema = z.object({ identifier });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

/**
 * The new password, with the same rules as sign-up's — a reset that accepted a
 * weaker password than registration would be the easier way in.
 */
export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine(values => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export const signUpSchema = z
  .object({
    email,
    phone: phoneSchema,
    password,
    confirmPassword: z.string().min(1, 'Confirm your password'),
    // ISO `YYYY-MM-DD`. The picker cannot emit anything else, so the check is
    // really guarding against an empty field rather than a malformed date.
    dateOfBirth: z
      .string()
      .min(1, 'Select your date of birth')
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Select your date of birth'),
    // `superRefine` rather than `refine`: a refine narrows the parsed type to
    // a non-null `Gender`, which then no longer matches the `null` the control
    // starts on, and react-hook-form's default values stop typechecking.
    gender: genderSchema.nullable().superRefine((value, ctx) => {
      if (value === null) {
        ctx.addIssue({ code: 'custom', message: 'Select an option' });
      }
    }),
    // `z.boolean().refine(...)` rather than `z.literal(true)`: a literal makes
    // the inferred type `true`, which a checkbox that starts unchecked cannot
    // satisfy, and react-hook-form's default values then fail to typecheck.
    acceptedTerms: z.boolean().refine(accepted => accepted, {
      message: 'You need to accept the terms to continue',
    }),
  })
  // Reported on `confirmPassword` rather than the form root, so the message
  // lands under the field the user has to fix.
  .refine(values => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type SignUpValues = z.infer<typeof signUpSchema>;

/**
 * What sign-up actually sends. The form's own bookkeeping does not travel:
 * `confirmPassword` only ever existed to catch a typo, and `acceptedTerms` is
 * a gate on the button rather than a user attribute — the server records
 * consent from the request itself.
 */
export interface SignUpPayload {
  email: string;
  /** E.164: dial code and national number joined, no spaces. */
  phone: string;
  password: string;
  dateOfBirth: string;
  gender: Gender;
}

export function toSignUpPayload(values: SignUpValues): SignUpPayload {
  return {
    // Already trimmed by the schema; lower-cased here so two sign-ups that
    // differ only in capitalisation cannot become two accounts.
    email: values.email.toLowerCase(),
    phone: `${findCountry(values.phone.country).dialCode}${values.phone.number}`,
    password: values.password,
    dateOfBirth: values.dateOfBirth,
    // The schema's refine has already ruled null out by the time a parsed value
    // reaches here; the assertion is what tells the compiler that.
    gender: values.gender as Gender,
  };
}

/**
 * The onboarding step between verifying a number and reaching the app.
 *
 * Deliberately does *not* ask for gender or date of birth: sign-up already
 * collected both, and asking a second time reads as the app having lost them.
 * What is left is the handful of things a fitness app cannot work without and
 * has no other way to learn.
 */
export const completeProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Enter your full name')
    .max(60, 'That name is too long'),
  /**
   * Height and weight are typed in whichever system the user picked, so the
   * bounds are checked after conversion rather than here — 175 is a sane
   * height in centimetres and an impossible one in inches.
   */
  units: unitSystemSchema,
  // Nullable with a `superRefine` rather than a plain `positive()`, for the
  // same reason `gender` is: an empty field is genuinely null, and a schema
  // that narrows null away stops matching the default value the control needs.
  height: z.number().nullable().superRefine((value, ctx) => {
    if (value === null || value <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Enter your height' });
    }
  }),
  weight: z.number().nullable().superRefine((value, ctx) => {
    if (value === null || value <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Enter your weight' });
    }
  }),
});
export type CompleteProfileValues = z.infer<typeof completeProfileSchema>;

/** What the profile call sends: canonical units, the way the model stores them. */
export interface CompleteProfilePayload {
  name: string;
  heightCm: number;
  weightKg: number;
  units: UnitSystem;
}

const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.45359237;

/** Plausible human ranges, checked once both figures are in canonical units. */
const HEIGHT_CM = { min: 90, max: 250 };
const WEIGHT_KG = { min: 25, max: 300 };

export function toCompleteProfilePayload(
  values: CompleteProfileValues,
): CompleteProfilePayload {
  const isImperial = values.units === 'imperial';
  // Null is ruled out by the schema before a parsed value reaches here; the
  // assertions are what tell the compiler that.
  const height = values.height as number;
  const weight = values.weight as number;

  return {
    name: values.name,
    // Rounded to a tenth: storing 177.79999999999998 cm because someone typed
    // 70 inches makes every later display need a rounding pass of its own.
    heightCm: round1(isImperial ? height * CM_PER_INCH : height),
    weightKg: round1(isImperial ? weight * KG_PER_LB : weight),
    units: values.units,
  };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** True when the entered figures land inside a plausible human range. */
export function isProfileWithinRange(payload: CompleteProfilePayload): boolean {
  return (
    payload.heightCm >= HEIGHT_CM.min &&
    payload.heightCm <= HEIGHT_CM.max &&
    payload.weightKg >= WEIGHT_KG.min &&
    payload.weightKg <= WEIGHT_KG.max
  );
}

/** Converts a typed figure when the user switches system, so it is not lost. */
export function convertMeasure(
  value: number,
  kind: 'height' | 'weight',
  to: UnitSystem,
): number {
  const factor = kind === 'height' ? CM_PER_INCH : KG_PER_LB;
  return round1(to === 'imperial' ? value / factor : value * factor);
}

export const profileSchema = z.object({
  name: z.string().min(2, 'Enter your name').max(60, 'That name is too long'),
  units: unitSystemSchema,
  goal: fitnessGoalSchema,
  activityLevel: activityLevelSchema,
  weeklyGoalWorkouts: z
    .number()
    .int()
    .min(1, 'Aim for at least one session a week')
    .max(14, 'More than twice a day is not a realistic target'),
  notes: z.string().max(280, 'Keep it under 280 characters').optional(),
});
export type ProfileValues = z.infer<typeof profileSchema>;
