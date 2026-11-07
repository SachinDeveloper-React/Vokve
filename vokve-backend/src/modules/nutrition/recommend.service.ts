import type { FoodSuggestion, FoodSuggestions, SuggestionGap } from '../../contracts/index.js';
import { getConfig } from '../../config/remote.js';
import type { IsoDate } from '../../lib/dates.js';
import { FoodItemModel } from './models.js';
import { getNutritionDay, getProfile } from './service.js';

/**
 * What the server suggests a member eats next (RULES N12).
 *
 * Rules, not a model, and deliberately so. A collaborative recommender
 * needs thousands of members' logs before it says anything but noise, and
 * the first thing it would say is noise — which is the one thing this
 * feature cannot survive. What a member's own day already knows is enough
 * to be useful: what they said they eat, what they are training for, and
 * the gap between their targets and the plate so far.
 *
 * Three rules, in order, and the order is the whole design:
 *
 *   1. **Never suggest what they do not eat.** A vegetarian shown chicken
 *      does not think "poor suggestion", they think the app does not know
 *      them, and they are right. This is a filter, never a penalty.
 *   2. **Never suggest what does not fit.** A 900 kcal dessert against the
 *      200 they have left is worse than silence: it reads as the app
 *      ignoring the targets it set them.
 *   3. **Answer the gap that is furthest behind.** Not the biggest gap in
 *      grams — the biggest as a *share* of its target, or protein would win
 *      every time it was measured against carbohydrate.
 *
 * And when there is nothing honest to say, it says nothing and explains
 * why. "The day is done" is a real answer; a shelf of smaller biscuits is
 * not.
 */

/**
 * The macros a suggestion can be chasing, and what each is called.
 *
 * Fibre is not among them, and that is a data fact rather than a choice:
 * the daily goals carry calories, protein, carbohydrate and fat, so fibre
 * has no target to be behind on. A gap measured against nothing is not a
 * gap.
 */
const MACROS: { gap: Exclude<SuggestionGap, 'calories'>; label: string; key: 'proteinG' | 'carbsG' | 'fatsG' }[] = [
  { gap: 'protein', label: 'protein', key: 'proteinG' },
  { gap: 'carbs', label: 'carbs', key: 'carbsG' },
  { gap: 'fats', label: 'fats', key: 'fatsG' },
];

interface FoodRow {
  _id: string;
  name: string;
  portion: string;
  emoji?: string | null;
  imageUrl?: string | null;
  dietTypes?: string[];
  calories: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatsG?: number | null;
  fiberG?: number | null;
}

export async function suggestFoods(userId: string, localDay: IsoDate): Promise<FoodSuggestions> {
  const config = await getConfig();
  const rules = config.nutrition.recommend;
  // Both through `getProfile`, never the collection: a member who has not
  // changed anything has *no profile row at all*, and the preferences they
  // are served come from the configured defaults. Reading the row directly
  // returns nothing for them, and whatever is then assumed is assumed for
  // every new member at once — which is how a vegetarian app ends up
  // recommending chicken to everybody who never opened the settings.
  const [day, profile] = await Promise.all([
    getNutritionDay(userId, localDay),
    getProfile(userId),
  ]);

  const remaining = {
    calories: round(day.goals.calories - day.totals.calories),
    proteinG: round(day.goals.proteinG - day.totals.proteinG),
    carbsG: round(day.goals.carbsG - day.totals.carbsG),
    fatsG: round(day.goals.fatsG - day.totals.fatsG),
  };

  const empty = (note: string): FoodSuggestions => ({ date: localDay, remaining, note, data: [] });

  // Rule 2, taken first because it is about the whole day rather than any
  // one food: under the floor there is nothing honest to suggest.
  if (remaining.calories < rules.minRemainingCalories) {
    return empty(
      remaining.calories <= 0
        ? 'You have met today’s calorie goal. Nothing more to suggest.'
        : `Only ${remaining.calories} kcal left today — not really enough to suggest anything.`,
    );
  }

  const dietType = profile.preferences.dietType;

  // Rule 1. A filter in the query, not a score: there is no amount of
  // being otherwise perfect that makes chicken a suggestion for a
  // vegetarian. An untagged food suits everyone, which is what a plain
  // ingredient is and what everything seeded before tags existed is.
  const ceiling = remaining.calories * (1 + rules.headroom);

  // `active: { $ne: false }` rather than `active: true`, which is the
  // house convention everywhere else this collection is read and not a
  // style choice: `true` does not match a document where the field is
  // absent, and a library that has been running has rows from before it
  // existed. The same trap as `$size: 0` below, one field along.
  const allowed = {
    active: { $ne: false },
    // Global foods only. A member's own custom food is theirs to log,
    // never ours to push back at them.
    ownerUserId: null,
    calories: { $gt: 0 },
    // `$size: 0` matches an *empty array* and not a missing field, so
    // every food written before the tag existed would be filtered out
    // and the shelf would come back empty. An absent tag means the same
    // as an empty one: it suits everyone.
    $or: [
      { dietTypes: { $exists: false } },
      { dietTypes: { $size: 0 } },
      { dietTypes: dietType },
    ],
  };

  // Read what the diet allows, then measure the calories here, so the
  // two reasons a shelf can be empty stay apart. Bounded because an
  // unbounded read of a growing library is a bill waiting to happen, and
  // ordered the way the library itself is, so the bound takes the foods
  // an operator put first rather than an arbitrary few.
  const permitted = await FoodItemModel.find(allowed, {
    name: 1, portion: 1, emoji: 1, imageUrl: 1, dietTypes: 1,
    calories: 1, proteinG: 1, carbsG: 1, fatsG: 1, fiberG: 1,
  })
    .sort({ sort: 1, name: 1 })
    .limit(rules.scanLimit)
    .lean<FoodRow[]>();

  const library = permitted.filter(food => food.calories <= ceiling);

  if (library.length === 0) {
    // Which wall it hit, because "nothing fits" collapses three very
    // different answers into one sentence — and an operator reading a
    // complaint cannot tell an empty library from a diet with nothing
    // tagged for it from a day with 130 calories left in it.
    if (permitted.length > 0) {
      return empty(
        `Nothing in the library is small enough for the ${Math.round(remaining.calories)} kcal you have left.`,
      );
    }
    const anyFood = await FoodItemModel.countDocuments({
      active: { $ne: false },
      ownerUserId: null,
    });
    return empty(
      anyFood > 0
        ? 'Nothing in the library is marked as suiting your diet yet.'
        : 'There is nothing in the food library yet.',
    );
  }

  // Rule 3. The share, not the grams: 40 g of protein short of 120 is a
  // third of the target, while 40 g of carbohydrate short of 300 is an
  // eighth, and it is the third that wants answering.
  const target = MACROS.map(macro => {
    const goal = day.goals[macro.key] ?? 0;
    const left = remaining[macro.key];
    return { ...macro, goal, left, share: goal > 0 ? left / goal : 0 };
  })
    .filter(macro => macro.share >= rules.macroGapShare && macro.left > 0)
    .sort((a, b) => b.share - a.share)[0];

  const scored = library
    .map(food => ({ food, score: scoreOf(food, target?.key ?? null) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, rules.limit);

  const data: FoodSuggestion[] = scored.map(({ food }) => ({
    food: toFood(food),
    gap: target?.gap ?? 'calories',
    reason: target
      ? `${Math.round(target.left)}g of ${target.label} still to go today`
      : `Fits the ${Math.round(remaining.calories)} kcal you have left`,
  }));

  return { date: localDay, remaining, note: null, data };
}

/**
 * How well one food answers the gap.
 *
 * Density rather than quantity — grams of the thing wanted per calorie
 * spent — because a member with 300 kcal left is choosing what to spend
 * them on, and the food with the most protein in the fridge is not the
 * answer if it costs the whole day's remainder to eat it.
 *
 * With no macro behind, the calories are the whole question and the score
 * is flat: the sort then falls back to the library's own order, which is
 * the order an operator put it in.
 */
function scoreOf(food: FoodRow, key: 'proteinG' | 'carbsG' | 'fatsG' | null): number {
  if (!key) return 0;
  const grams = Number(food[key] ?? 0);
  return grams <= 0 ? 0 : grams / Math.max(1, food.calories);
}


function toFood(row: FoodRow) {
  return {
    id: row._id,
    name: row.name,
    portion: row.portion,
    emoji: row.emoji ?? '🍽️',
    dietTypes: row.dietTypes ?? [],
    imageUrl: row.imageUrl ?? null,
    calories: row.calories,
    proteinG: row.proteinG ?? 0,
    carbsG: row.carbsG ?? 0,
    fatsG: row.fatsG ?? 0,
    fiberG: row.fiberG ?? 0,
  };
}

const round = (value: number) => Math.round(value * 10) / 10;
