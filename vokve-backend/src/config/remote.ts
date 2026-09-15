import { AppConfigModel } from '../modules/platform/models.js';
import { CONFIG_DEFAULTS, type AppConfig } from './defaults.js';

/**
 * Remote config: `app_config` documents override the defaults key by key.
 * Cached in memory for a short window so a hot path never waits on a read;
 * `invalidate()` after an admin write.
 */
const TTL_MS = 30_000;
let cached: { at: number; value: AppConfig } | null = null;

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return (patch === undefined ? base : patch) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = deepMerge(out[k], v);
  }
  return out as T;
}

export async function getConfig(): Promise<AppConfig> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.value;
  }
  const docs = await AppConfigModel.find().lean();
  let value: AppConfig = structuredClone(CONFIG_DEFAULTS);
  for (const doc of docs) {
    value = deepMerge(value, { [String(doc._id)]: doc.value });
  }
  validate(value);
  cached = { at: Date.now(), value };
  return value;
}

export function invalidateConfig(): void {
  cached = null;
}

/** RULES E8c: no per-source cap may exceed the daily ceiling. */
function validate(config: AppConfig): void {
  for (const [source, cap] of Object.entries(config.coins.sourceCaps)) {
    if (cap > config.coins.dailyCap) {
      throw new Error(`coins.sourceCaps.${source} (${cap}) exceeds coins.dailyCap (${config.coins.dailyCap})`);
    }
  }
}
