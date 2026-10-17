import { z } from 'zod';
import { CONFIG_DEFAULTS, type AppConfig } from '../../config/defaults.js';
import { assertConfigValid, deepMerge, getConfig, invalidateConfig } from '../../config/remote.js';
import { Errors } from '../../lib/errors.js';
import { AppConfigModel, AuditLogModel } from '../platform/models.js';

/**
 * The step pipeline's knobs, as something an operator can turn (RULES A1–A28).
 *
 * Everything that decides what happens to a member's steps is already
 * config — what the phone is told to count, when it must have reported by,
 * what the layers refuse, what a verified day is worth, and what the trust
 * tier lets through. None of it was reachable without editing the database
 * by hand, so in practice it was a deploy-time decision wearing config's
 * clothes.
 *
 * Three things make this safe to expose:
 *
 *   - **A patch is checked before it is written.** `validate()` in
 *     `config/remote.ts` runs on *read*: a bad document would not fail the
 *     write that caused it, it would fail every `getConfig()` in the
 *     process — every member, every route — until somebody worked out which
 *     key did it. So the patch is merged onto the live config in memory,
 *     validated there, and only then persisted.
 *   - **Only these keys exist.** The schema below is a closed list with
 *     `.strict()` at every level: a typo is a 422 rather than a stray key
 *     that silently does nothing (`deepMerge` would happily add it).
 *   - **Nothing is replaced wholesale.** Writes are `$set` on dotted paths,
 *     so two operators changing two knobs do not overwrite each other, and
 *     `reset` is `$unset` — which puts the key back to the code's default
 *     rather than to whatever it was before.
 */

const ratio = z.number().min(0).max(1);
const score = z.number().min(0).max(100);
const positive = z.number().int().positive();

/**
 * What may be changed, with the bounds a *typo* has to clear before the
 * cross-field validator sees it. These are outer limits, not advice: the
 * ladder rules (an impossible day above a flagged one, a reminder after the
 * silent push) are checked by `assertConfigValid` against the whole config.
 */
export const stepsConfigPatch = z
  .object({
    activity: z
      .object({
        tracker: z
          .object({
            healthConnectWriteEnabled: z.boolean(),
            healthConnectWriteGranularity: z.enum(['day', 'minute']),
            healthConnectIgnoreManualEntries: z.boolean(),
            wearableTrust: z.enum(['metadata', 'catalog']),
            wearableAllowlist: z.array(z.string().trim().min(1).max(120)).max(50),
            gapRecovery: z.enum(['split', 'today', 'today_capped', 'drop']),
            historyRetentionDays: z.number().int().min(1).max(1000),
            motionWindowRetention: z.number().int().min(1).max(10_000),
            fraudDetection: z.object({ enabled: z.boolean(), mode: z.enum(['flag', 'exclude']) }).strict().partial(),
            motionSampling: z
              .object({
                enabled: z.boolean(),
                windowSeconds: z.number().int().min(1).max(120),
                intervalMinutes: z.number().int().min(1).max(240),
              })
              .strict()
              .partial(),
          })
          .strict()
          .partial(),
        sync: z
          .object({
            intervalMinutes: z.number().int().min(1).max(240),
            minGapSeconds: z.number().int().min(0).max(3600),
          })
          .strict()
          .partial(),
        goal: z
          .object({
            min: z.number().int().min(500).max(50_000),
            max: z.number().int().min(1000).max(100_000),
            increment: z.number().int().min(50).max(5000),
          })
          .strict()
          .partial(),
        /** A day older than this can never be sent (RULES A8). */
        maxAgeDays: z.number().int().min(1).max(60),
        futureSkewMinutes: z.number().int().min(0).max(240),
        activeMinuteSteps: z.number().int().min(1).max(300),
        rawSnapshotRetentionDays: z.number().int().min(1).max(400),
        /** At or above this day score, and with no hard reject, a day verifies (A20). */
        verifiedMinScore: score,
        /** The upload floor's ladder (RULES A28) — the one that sends messages. */
        syncNudge: z
          .object({
            enabled: z.boolean(),
            silentAfterHours: z.number().int().min(1).max(336),
            cooldownHours: z.number().int().min(1).max(336),
            remindAfterHours: z.number().int().min(1).max(720),
            giveUpAfterDays: z.number().int().min(1).max(365),
            batch: z.number().int().min(1).max(10_000),
          })
          .strict()
          .partial(),
        thresholds: z
          .object({
            maxDailySteps: z.number().int().min(1000).max(500_000),
            impossibleDailySteps: z.number().int().min(1000).max(1_000_000),
            maxStepsPerMinute: z.number().int().min(60).max(1000),
            untimedShare: ratio,
            suspectShareHard: ratio,
            nightShare: ratio,
            unaccountedShare: z.number().min(0.01).max(1),
            /** Null until the shadow period says what honest phones send (A12). */
            unaccountedShareHard: ratio.nullable(),
            uncorroboratedSteps: z.number().int().min(0).max(100_000),
            newInstallSteps: z.number().int().min(0).max(200_000),
            roundTotalDays: z.number().int().min(1).max(7),
            clockJumpMinutes: z.number().int().min(1).max(1440),
            pedometerRatio: z
              .object({ min: z.number().min(0).max(5), max: z.number().min(0).max(10), hard: z.number().min(0).max(20) })
              .strict()
              .partial(),
            strideMeters: z.object({ min: z.number().min(0.1).max(2), max: z.number().min(0.1).max(3) }).strict().partial(),
            motion: z
              .object({
                walkMinHz: z.number().min(0).max(20),
                walkMaxHz: z.number().min(0).max(20),
                shakeMinHz: z.number().min(0).max(40),
                shakeMinVariance: z.number().min(0).max(1000),
                stillMaxHz: z.number().min(0).max(20),
                nonWalkHardShare: ratio,
                absentScore: score,
              })
              .strict()
              .partial(),
          })
          .strict()
          .partial(),
        provenance: z
          .object({
            allow: z.array(z.string().trim().min(1).max(120)).max(100),
            deny: z.array(z.string().trim().min(1).max(120)).max(100),
            trustTrackerCatalog: z.boolean(),
            countUnknownMethod: z.boolean(),
          })
          .strict()
          .partial(),
        inspector: z.object({ showChecks: z.boolean().nullable() }).strict().partial(),
      })
      .strict()
      .partial(),
    coins: z
      .object({
        /** `enabled` is the one that starts minting; a minted coin cannot be taken back. */
        steps: z
          .object({
            enabled: z.boolean(),
            unitSteps: z.number().int().min(1).max(10_000),
            coinsPerUnit: z.number().min(0).max(100),
          })
          .strict()
          .partial(),
        sourceCaps: z.object({ steps: z.number().min(0).max(10_000) }).strict().partial(),
        dailyCap: z.number().min(0).max(100_000),
      })
      .strict()
      .partial(),
    trust: z
      .object({
        /** The daily step ceiling each tier is credited up to. */
        stepCaps: z
          .object({
            trusted: z.number().int().min(0).max(200_000),
            normal: z.number().int().min(0).max(200_000),
            watch: z.number().int().min(0).max(200_000),
            restricted: z.number().int().min(0).max(200_000),
            banned: z.number().int().min(0).max(200_000),
          })
          .strict()
          .partial(),
        /** How long step coins sit in escrow before they are released (E15). */
        holdHours: z
          .object({
            trusted: z.number().int().min(0).max(8760),
            normal: z.number().int().min(0).max(8760),
            watch: z.number().int().min(0).max(8760),
            restricted: z.number().int().min(0).max(8760).nullable(),
          })
          .strict()
          .partial(),
        tiers: z.object({ trusted: score, normal: score, watch: score }).strict().partial(),
        /** Shadow: the score and tier are computed and never enforced (T9). */
        shadow: z.boolean(),
      })
      .strict()
      .partial(),
    telemetry: z
      .object({
        health: z.object({ staleHours: z.number().int().min(1).max(720) }).strict().partial(),
        problems: z
          .object({
            noUploadHours: z.number().int().min(1).max(720),
            errorDays: z.number().int().min(1).max(90),
            errorGroupsForFinding: positive.max(100),
            unverifiedDays: z.number().int().min(1).max(90),
          })
          .strict()
          .partial(),
      })
      .strict()
      .partial(),
  })
  .strict()
  .partial();

export type StepsConfigPatch = z.infer<typeof stepsConfigPatch>;

/** The sections this surface may touch. Anything else is somebody else's. */
const SECTIONS = ['activity', 'coins', 'trust', 'telemetry'] as const;
type Section = (typeof SECTIONS)[number];

/** `{ a: { b: 1 } }` → `{ 'a.b': 1 }`. Arrays are values, not branches. */
function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { [prefix]: value };
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    Object.assign(out, flatten(child, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

/** The value at a dotted path, or undefined where the path does not exist. */
function at(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[key];
  }, source);
}

export interface StepsConfigView {
  /** What the server is using right now, for the keys this surface owns. */
  effective: Record<Section, unknown>;
  /** The same keys as the code ships them, so a change can be read against its default. */
  defaults: Record<Section, unknown>;
  /**
   * Every key whose stored value differs from the code's, with both — the
   * answer to "why is this box not what the code says".
   */
  overrides: { path: string; value: unknown; default: unknown }[];
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Only the parts of the config this surface owns, effective and default. */
function slice(config: AppConfig) {
  return {
    activity: config.activity,
    coins: { steps: config.coins.steps, sourceCaps: { steps: config.coins.sourceCaps.steps }, dailyCap: config.coins.dailyCap },
    trust: { stepCaps: config.trust.stepCaps, holdHours: config.trust.holdHours, tiers: config.trust.tiers, shadow: config.trust.shadow },
    telemetry: { health: config.telemetry.health, problems: config.telemetry.problems },
  } as Record<Section, unknown>;
}

export async function stepsConfig(): Promise<StepsConfigView> {
  const [config, docs] = await Promise.all([
    getConfig(),
    AppConfigModel.find({ _id: { $in: SECTIONS } }).lean(),
  ]);

  const overrides: StepsConfigView['overrides'] = [];
  let updatedBy: string | null = null;
  let updatedAt: Date | null = null;
  for (const doc of docs) {
    for (const [path, value] of Object.entries(flatten(doc.value ?? {}))) {
      if (path === '') continue;
      const full = `${String(doc._id)}.${path}`;
      const fallback = at(CONFIG_DEFAULTS, full);
      // Stored is not overridden. The seed writes a whole copy of every
      // section on a fresh database (`$setOnInsert`), so most of what is in
      // `app_config` is the default sitting in a document. What is worth
      // showing is only where the two have parted — which also catches the
      // case nobody would otherwise notice: a default the code has since
      // changed, pinned by a copy an older seed wrote.
      if (JSON.stringify(value) === JSON.stringify(fallback)) continue;
      overrides.push({ path: full, value, default: fallback });
    }
    const docUpdated = (doc as { updatedAt?: Date }).updatedAt ?? null;
    if (docUpdated && (!updatedAt || docUpdated > updatedAt)) {
      updatedAt = docUpdated;
      updatedBy = (doc as { updatedBy?: string }).updatedBy ?? null;
    }
  }

  return {
    effective: slice(config),
    defaults: slice(CONFIG_DEFAULTS),
    // Only the keys this surface owns: an override on `commerce` is real,
    // but it is not this page's business and showing it would invite an
    // operator to think this page could change it.
    overrides: overrides.filter(row => at(slice(CONFIG_DEFAULTS), row.path) !== undefined),
    updatedBy,
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}

export interface SetStepsConfigBody {
  patch?: StepsConfigPatch;
  /** Dotted paths to put back to the code's default, e.g. `activity.maxAgeDays`. */
  reset?: string[];
  /** Why, in the operator's words. Kept on the audit row. */
  note?: string;
}

export const setStepsConfigBody = z
  .object({
    patch: stepsConfigPatch.optional(),
    reset: z.array(z.string().regex(/^[a-zA-Z]+(\.[a-zA-Z0-9]+)*$/).max(80)).max(50).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine(body => (body.patch && Object.keys(body.patch).length > 0) || (body.reset && body.reset.length > 0), 'Change something');

export async function setStepsConfig(actor: string, body: SetStepsConfigBody): Promise<StepsConfigView> {
  const before = await getConfig();
  const patch = body.patch ?? {};
  const reset = body.reset ?? [];

  for (const path of reset) {
    const [section] = path.split('.');
    if (!SECTIONS.includes(section as Section) || at(CONFIG_DEFAULTS, path) === undefined) {
      throw Errors.validation({ reset: `'${path}' is not a key this surface owns.` });
    }
  }

  // What the config *would* be. Reset first, so a patch and a reset of the
  // same key in one call means the patch wins rather than the order of two
  // database writes deciding it.
  const preview = structuredClone(before) as AppConfig;
  for (const path of reset) {
    const keys = path.split('.');
    const leaf = keys.pop()!;
    const parent = keys.reduce<Record<string, unknown>>(
      (node, key) => node[key] as Record<string, unknown>,
      preview as unknown as Record<string, unknown>,
    );
    parent[leaf] = at(CONFIG_DEFAULTS, path);
  }
  const merged = deepMerge(preview, patch);

  try {
    assertConfigValid(merged);
  } catch (error) {
    // The validator speaks in whole sentences — "coins.sourceCaps.steps (400)
    // exceeds coins.dailyCap (300)" — which is exactly what the operator
    // needs to read, so it is handed back rather than swallowed.
    throw Errors.validation({ config: error instanceof Error ? error.message : 'That config would not be accepted.' });
  }

  const bySection = new Map<Section, { set: Record<string, unknown>; unset: Record<string, ''> }>();
  const edit = (section: Section) => {
    const existing = bySection.get(section) ?? { set: {}, unset: {} };
    bySection.set(section, existing);
    return existing;
  };
  for (const [section, value] of Object.entries(patch)) {
    for (const [path, leaf] of Object.entries(flatten(value))) {
      if (path === '') continue;
      edit(section as Section).set[`value.${path}`] = leaf;
    }
  }
  for (const path of reset) {
    const [section, ...rest] = path.split('.');
    edit(section as Section).unset[`value.${rest.join('.')}`] = '';
  }

  for (const [section, ops] of bySection) {
    await AppConfigModel.updateOne(
      { _id: section },
      {
        ...(Object.keys(ops.set).length > 0 ? { $set: { ...ops.set, updatedBy: actor } } : { $set: { updatedBy: actor } }),
        ...(Object.keys(ops.unset).length > 0 ? { $unset: ops.unset } : {}),
      },
      { upsert: true },
    );
  }
  invalidateConfig();

  const changed = Object.keys(flatten(patch)).filter(path => path !== '');
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'config.steps',
    subjectType: 'app_config',
    subjectId: [...bySection.keys()].join(','),
    before: Object.fromEntries(changed.map(path => [path, at(before, path)])),
    after: { ...Object.fromEntries(changed.map(path => [path, at(merged, path)])), reset, note: body.note ?? null },
  });

  return stepsConfig();
}
