import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { logger } from '../lib/logger.js';
import { SupportFaqModel, SupportGuideSectionModel } from '../modules/account/models.js';
import { AppReleaseModel } from '../modules/devices/models.js';
import { AppConfigModel } from '../modules/platform/models.js';
import { CouponModel, ShopCategoryModel, ShopInventoryModel, ShopItemModel } from '../modules/commerce/models.js';
import { ExerciseModel, WorkoutTemplateModel } from '../modules/training/models.js';
import { AchievementDefinitionModel, ChallengeDefinitionModel } from '../modules/challenges/models.js';
import { ContentTipModel } from '../modules/content/models.js';
import { DietPlanModel, FoodItemModel } from '../modules/nutrition/models.js';
import { addDays, localDayOf } from '../lib/dates.js';
import { CONFIG_DEFAULTS } from '../config/defaults.js';
import {
  ACHIEVEMENTS, APP_RELEASES, CHALLENGES, CONTENT_TIPS, COUPONS, DIET_PLANS, EXERCISES, FOOD_ITEMS, SHOP_CATEGORIES, SHOP_ITEM_DETAILS, SHOP_ITEMS, SHOP_STOCK,
  SUPPORT_FAQS, SUPPORT_GUIDE_SECTIONS, WORKOUT_TEMPLATES,
} from './data.js';

/**
 * Which of `ids` an operator has written since, and the seed must leave alone.
 *
 * The food library and the diet plans are content the seed starts and the
 * operator then owns. A re-seed that `$set` them back would quietly undo the
 * real plan somebody wrote through `/v1/admin/*` — and a re-seed happens on
 * every deploy, so the loss would arrive without anybody touching the plan.
 * `updatedBy` is the mark: `seed` means nobody has.
 */
async function operatorOwned(
  model: { find: (filter: object, projection: object) => { lean: () => Promise<{ _id: string }[]> } },
  ids: string[],
): Promise<Set<string>> {
  const rows = await model
    .find({ _id: { $in: ids }, updatedBy: { $exists: true, $nin: [null, 'seed'] } }, { _id: 1 })
    .lean();
  return new Set(rows.map(row => row._id));
}

/**
 * Idempotent: safe to run on every deploy. Never touches user data.
 *
 * `now` is a parameter so a test can seed at an instant where the server's
 * own calendar and the members' differ — the mistake the challenge opening
 * days were making (see `seededOn`).
 */
export async function seed(now = new Date()): Promise<void> {
  await Promise.all(EXERCISES.map(e => ExerciseModel.updateOne({ _id: e._id }, { $set: e }, { upsert: true })));
  await Promise.all(WORKOUT_TEMPLATES.map(t => WorkoutTemplateModel.updateOne({ _id: t._id }, { $set: t }, { upsert: true })));
  // Catalogue rows are the seed's to overwrite — copy, tags, price — except
  // `popularity`, which is what selling has added to the starting figure.
  // The product-page details are set in full every time, so a detail
  // taken out of the seed is taken off the page too.
  // The shelves before the items on them: an item write checks its shelf
  // exists, and a re-seed should not depend on the bootstrap having run.
  // Only these four, and only the fields the seed owns — a shelf an
  // operator added, and a subcategory they added to one of these, are
  // theirs and are left alone.
  await Promise.all(SHOP_CATEGORIES.map(async category => {
    const { subcategories, ...shelf } = category;
    await ShopCategoryModel.updateOne({ _id: shelf._id }, { $set: shelf }, { upsert: true });
    const row = await ShopCategoryModel.findById(shelf._id, { subcategories: 1 }).lean();
    const listed = new Set((row?.subcategories ?? []).map(sub => sub.name));
    const extra = subcategories.filter(name => !listed.has(name));
    if (extra.length > 0) {
      await ShopCategoryModel.updateOne(
        { _id: shelf._id },
        { $push: { subcategories: { $each: extra.map((name, index) => ({ name, sort: listed.size + index, active: true })) } } },
      );
    }
  }));
  await Promise.all(SHOP_ITEMS.map(({ popularity, ...i }) => {
    const details = { ribbon: null, colors: [], highlights: [], features: [], specs: [], ...SHOP_ITEM_DETAILS[i._id] };
    // `paymentMode: null` first, so dropping an item's own mode from the seed puts it back on the shop's.
    return ShopItemModel.updateOne({ _id: i._id }, { $set: { paymentMode: null, ...i, ...details }, $setOnInsert: { popularity } }, { upsert: true });
  }));
  // Stock is only ever *created* by the seed: a re-seed must not undo sales.
  await Promise.all(SHOP_STOCK.map(s => ShopInventoryModel.updateOne({ _id: s._id }, { $setOnInsert: s }, { upsert: true })));
  // Coupons too: an operator's edit and the redemption count outlive a re-seed.
  await Promise.all(COUPONS.map(c => CouponModel.updateOne({ _id: c._id }, { $setOnInsert: c }, { upsert: true })));
  await Promise.all(APP_RELEASES.map(r => AppReleaseModel.updateOne({ platform: r.platform, version: r.version, build: r.build }, { $set: r }, { upsert: true })));
  // Help articles are the seed's to keep current: support edits land in the
  // collection, and a re-seed restores the wording the app shipped with.
  await Promise.all(SUPPORT_FAQS.map(f => SupportFaqModel.updateOne({ _id: f._id }, { $set: f }, { upsert: true })));
  // The app guide goes stale the day a screen changes, so the seed owns its
  // wording the same way: support's edits live in the collection, and a
  // re-seed puts back the guide this release shipped with.
  await Promise.all(SUPPORT_GUIDE_SECTIONS.map(s => SupportGuideSectionModel.updateOne({ _id: s._id }, { $set: s }, { upsert: true })));
  // The challenge board and the achievement shelf are the seed's wording, but
  // an opening day, once set, is never moved by a re-seed.
  // The calendar the challenge rules are judged on, not the server's:
  // `startsOn <= day` is asked of the member's local day, so a day taken
  // from UTC is one behind for every zone ahead of it. In IST that is true
  // from 18:30 UTC each evening, which made a challenge seeded to open
  // "tomorrow" open today.
  const seededOn = localDayOf(now, CONFIG_DEFAULTS.locale.timezone);
  await Promise.all(CHALLENGES.map(({ startsInDays, ...c }) =>
    ChallengeDefinitionModel.updateOne(
      { _id: c._id },
      { $set: c, $setOnInsert: { startsOn: startsInDays === null ? null : addDays(seededOn, startsInDays) } },
      { upsert: true },
    )));
  await Promise.all(ACHIEVEMENTS.map(a => AchievementDefinitionModel.updateOne({ _id: a._id }, { $set: a }, { upsert: true })));
  // The tips' wording is the seed's to keep current; whether one is shown is the operator's.
  await Promise.all(CONTENT_TIPS.map(({ _id, ...t }) =>
    ContentTipModel.updateOne({ _id }, { $set: t, $setOnInsert: { active: true } }, { upsert: true })));
  // The foods the app ships with. Whether one is still offered is the
  // operator's (they retire it through /v1/admin/foods), so a re-seed
  // restores the figures without putting a retired food back on the shelf —
  // and a food the operator has edited is theirs now, so it is skipped.
  const ownedFoods = await operatorOwned(FoodItemModel, FOOD_ITEMS.map(f => f._id));
  await Promise.all(FOOD_ITEMS.filter(f => !ownedFoods.has(f._id)).map(({ _id, ...f }) =>
    FoodItemModel.updateOne(
      { _id },
      { $set: { ...f, ownerUserId: null, updatedBy: 'seed' }, $setOnInsert: { active: true } },
      { upsert: true },
    )));
  // The plans the app ships with. A re-seed restores the wording of the three
  // it shipped with and leaves whether they are on offer to the operator; one
  // they have edited is no longer the seed's to rewrite.
  const ownedPlans = await operatorOwned(DietPlanModel, DIET_PLANS.map(p => p._id));
  await Promise.all(DIET_PLANS.filter(p => !ownedPlans.has(p._id)).map(({ _id, ...plan }) =>
    DietPlanModel.updateOne(
      { _id },
      { $set: { ...plan, updatedBy: 'seed' }, $setOnInsert: { active: true } },
      { upsert: true },
    )));
  // Config documents are created only if absent, so an operator's override survives a re-seed.
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    await AppConfigModel.updateOne({ _id: key }, { $setOnInsert: { _id: key, value, updatedBy: 'seed' } }, { upsert: true });
  }
}

const isEntry = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isEntry) {
  connectMongo()
    // Not `.then(seed)`: that would hand the resolved value in as `now`.
    .then(() => seed())
    .then(() => logger.info('seeded'))
    .catch(err => { logger.error({ err }, 'seed failed'); process.exitCode = 1; })
    .finally(disconnectMongo);
}
