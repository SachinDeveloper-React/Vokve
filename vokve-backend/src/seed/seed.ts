import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { logger } from '../lib/logger.js';
import { SupportFaqModel } from '../modules/account/models.js';
import { AppReleaseModel } from '../modules/devices/models.js';
import { AppConfigModel } from '../modules/platform/models.js';
import { ShopInventoryModel, ShopItemModel } from '../modules/commerce/models.js';
import { ExerciseModel, WorkoutTemplateModel } from '../modules/training/models.js';
import { AchievementDefinitionModel, ChallengeDefinitionModel } from '../modules/challenges/models.js';
import { ContentTipModel } from '../modules/content/models.js';
import { DietPlanTemplateModel, FoodItemModel } from '../modules/nutrition/models.js';
import { addDays } from '../lib/dates.js';
import { CONFIG_DEFAULTS } from '../config/defaults.js';
import {
  ACHIEVEMENTS, APP_RELEASES, CHALLENGES, CONTENT_TIPS, DIET_PLAN_TEMPLATES, EXERCISES, FOOD_ITEMS, SHOP_ITEMS, SHOP_STOCK,
  SUPPORT_FAQS, WORKOUT_TEMPLATES,
} from './data.js';

/** Idempotent: safe to run on every deploy. Never touches user data. */
export async function seed(): Promise<void> {
  await Promise.all(EXERCISES.map(e => ExerciseModel.updateOne({ _id: e._id }, { $set: e }, { upsert: true })));
  await Promise.all(WORKOUT_TEMPLATES.map(t => WorkoutTemplateModel.updateOne({ _id: t._id }, { $set: t }, { upsert: true })));
  // Catalogue rows are the seed's to overwrite — copy, tags, price — except
  // `popularity`, which is what selling has added to the starting figure.
  await Promise.all(SHOP_ITEMS.map(({ popularity, ...i }) =>
    ShopItemModel.updateOne({ _id: i._id }, { $set: i, $setOnInsert: { popularity } }, { upsert: true })));
  // Stock is only ever *created* by the seed: a re-seed must not undo sales.
  await Promise.all(SHOP_STOCK.map(s => ShopInventoryModel.updateOne({ _id: s._id }, { $setOnInsert: s }, { upsert: true })));
  await Promise.all(APP_RELEASES.map(r => AppReleaseModel.updateOne({ platform: r.platform, version: r.version, build: r.build }, { $set: r }, { upsert: true })));
  // Help articles are the seed's to keep current: support edits land in the
  // collection, and a re-seed restores the wording the app shipped with.
  await Promise.all(SUPPORT_FAQS.map(f => SupportFaqModel.updateOne({ _id: f._id }, { $set: f }, { upsert: true })));
  // The challenge board and the achievement shelf are the seed's wording, but
  // an opening day, once set, is never moved by a re-seed.
  const seededOn = new Date().toISOString().slice(0, 10);
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
  // The global food library and the plan's curated days are the seed's to keep current.
  await Promise.all(FOOD_ITEMS.map(({ _id, ...f }) =>
    FoodItemModel.updateOne({ _id }, { $set: { ...f, ownerUserId: null } }, { upsert: true })));
  await Promise.all(DIET_PLAN_TEMPLATES.map(({ _id, ...t }) =>
    DietPlanTemplateModel.updateOne({ _id }, { $set: t, $setOnInsert: { active: true } }, { upsert: true })));
  // Config documents are created only if absent, so an operator's override survives a re-seed.
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    await AppConfigModel.updateOne({ _id: key }, { $setOnInsert: { _id: key, value, updatedBy: 'seed' } }, { upsert: true });
  }
}

const isEntry = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isEntry) {
  connectMongo()
    .then(seed)
    .then(() => logger.info('seeded'))
    .catch(err => { logger.error({ err }, 'seed failed'); process.exitCode = 1; })
    .finally(disconnectMongo);
}
