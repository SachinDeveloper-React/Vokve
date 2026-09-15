import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { logger } from '../lib/logger.js';
import { AppReleaseModel } from '../modules/devices/models.js';
import { AppConfigModel } from '../modules/platform/models.js';
import { ExerciseModel, WorkoutTemplateModel } from '../modules/training/models.js';
import { CONFIG_DEFAULTS } from '../config/defaults.js';
import { APP_RELEASES, EXERCISES, WORKOUT_TEMPLATES } from './data.js';

/** Idempotent: safe to run on every deploy. Never touches user data. */
export async function seed(): Promise<void> {
  await Promise.all(EXERCISES.map(e => ExerciseModel.updateOne({ _id: e._id }, { $set: e }, { upsert: true })));
  await Promise.all(WORKOUT_TEMPLATES.map(t => WorkoutTemplateModel.updateOne({ _id: t._id }, { $set: t }, { upsert: true })));
  await Promise.all(APP_RELEASES.map(r => AppReleaseModel.updateOne({ platform: r.platform, version: r.version, build: r.build }, { $set: r }, { upsert: true })));
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
