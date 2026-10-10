import type { HydrationEntry, HydrationLimits } from '../types/models';

/**
 * Whether a drink about to be logged is believable (RULES Y1b).
 *
 * ## Why this is on the phone at all
 *
 * The server is the authority and refuses a day past its ceiling whatever
 * the client does — that is what protects the average, the goal-hit rate and
 * the streak from one 15-litre day, and it has to hold for any client, not
 * just this one. But a refusal arrives *after* the tap, by which time the
 * quick-add has already moved the figure on screen and the user has to watch
 * it move back. So the same question is asked here first, from the
 * thresholds the server sent with the day.
 *
 * The split is deliberate: the server owns the *numbers* and the wording of
 * standing facts ("you have drunk 6.4 L today"), because those can change
 * without a release and one of them is close to medical advice. The app owns
 * the wording of the *hypothetical* ("this would take you to 6.4 L"), which
 * no server can pre-write because it is about a tap that has not happened.
 *
 * ## Why confirm rather than refuse
 *
 * Six litres in a day is unusual, not impossible: an endurance athlete in
 * summer really does drink that. Refusing it would lose true data and insult
 * the user. Asking costs one tap and stops a mis-tap becoming a month of bad
 * averages — which is the actual failure being prevented.
 *
 * The rate is the exception worth taking seriously on its own: healthy
 * kidneys clear roughly a litre an hour, so drinking much faster than that
 * is the part with medicine behind it rather than tidiness. It is asked
 * about before the daily total, and only one question is ever raised, so the
 * app never stacks two warnings over one tap.
 */

export type WaterVerdict =
  /** Log it. */
  | { kind: 'ok' }
  /** Cannot be logged at all; the message says why and what is left. */
  | { kind: 'refuse'; title: string; message: string }
  /** Ask first. Confirming logs it unchanged. */
  | { kind: 'confirm'; title: string; message: string };

export interface WaterState {
  /** The day's total so far, as the screen shows it. */
  consumedMl: number;
  /** The day's drinks, for the rolling-hour window. */
  entries: HydrationEntry[];
  limits: HydrationLimits;
}

/** "6.4 L", or "800 ml" below a litre — the way a person says it. */
export function litres(ml: number): string {
  return ml >= 1000 ? `${(ml / 1000).toFixed(1)} L` : `${ml} ml`;
}

/** What has gone in over the last `minutes`, for the rate question. */
export function recentMl(
  entries: HydrationEntry[],
  minutes: number,
  now: Date = new Date(),
): number {
  const since = now.getTime() - minutes * 60_000;
  return entries
    .filter(entry => {
      const at = new Date(entry.at).getTime();
      return Number.isFinite(at) && at >= since;
    })
    .reduce((sum, entry) => sum + entry.ml, 0);
}

export function checkWaterAdd(
  ml: number,
  { consumedMl, entries, limits }: WaterState,
  now: Date = new Date(),
): WaterVerdict {
  const amount = Math.round(ml);

  // One drink's own bounds. A 4-litre glass is a typo, not a drink, and the
  // server would refuse it too.
  if (amount < limits.minMl || amount > limits.maxMl) {
    return {
      kind: 'refuse',
      title: 'That is not an amount Vokve can log',
      message: `A single drink has to be between ${litres(limits.minMl)} and ${litres(
        limits.maxMl,
      )}.`,
    };
  }

  // The day's ceiling. Said as what is left rather than what is forbidden:
  // "you can still log 400 ml" is something a user can act on.
  const after = consumedMl + amount;
  if (after > limits.maxDailyMl) {
    const remaining = Math.max(0, limits.maxDailyMl - consumedMl);
    return {
      kind: 'refuse',
      title: `${litres(limits.maxDailyMl)} is the most Vokve records in a day`,
      message:
        remaining >= limits.minMl
          ? `You are at ${litres(consumedMl)} today, so you can still log ${litres(
              remaining,
            )}.`
          : `You are at ${litres(
              consumedMl,
            )} today. Anything more is not something Vokve can record — and if you really are drinking this much, it is worth asking a doctor about.`,
    };
  }

  // The rate, before the total: a member drinking too fast should be asked
  // about that, not about their day.
  const recent = recentMl(entries, limits.hourlyMinutes, now) + amount;
  if (recent > limits.hourlyMl) {
    return {
      kind: 'confirm',
      title: 'That is fast — log it anyway?',
      message: `This would make ${litres(recent)} in the last hour. Healthy kidneys clear about a litre an hour, so drinking faster than that for long can be harmful.`,
    };
  }

  if (after > limits.confirmAboveMl) {
    return {
      kind: 'confirm',
      title: 'That is a lot of water — log it anyway?',
      message: `This would take you to ${litres(
        after,
      )} today. Tap Log water if that is right, or Cancel if it was a mis-tap.`,
    };
  }

  return { kind: 'ok' };
}
