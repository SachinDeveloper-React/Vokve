import { WorkoutModel } from './models.js';

/**
 * Plausible workouts as the leaderboard, challenges and badges count them
 * (RULES W5): at most `perDay` a local day.
 *
 * A plausible workout is the member's say-so — a start, an end and a set
 * ticked — so counting every one let a script save a thousand in a day and
 * top the weekly board, or finish a month's workout challenge in a minute
 * (security audit 2026-11-27, C-1). The coins were already held to one a
 * day by the source cap; this holds the counts to the same idea.
 */
export async function countedWorkouts(
  userId: string,
  perDay: number,
  days?: { $gte: string; $lte: string },
): Promise<number> {
  const [row] = await WorkoutModel.aggregate<{ total: number }>([
    { $match: { userId, plausible: true, deletedAt: null, ...(days ? { localDay: days } : {}) } },
    { $group: { _id: '$localDay', n: { $sum: 1 } } },
    { $group: { _id: null, total: { $sum: { $min: ['$n', Math.max(0, perDay)] } } } },
  ]);
  return row?.total ?? 0;
}
