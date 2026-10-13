import { getConfig } from '../../config/remote.js';
import { appUpdateSchema, type AppUpdate } from '../../contracts/index.js';
import { compareVersions } from '../../middleware/version.js';
import { AppReleaseModel } from './models.js';

/**
 * What a build must do about its own version (RULES DV12) — the polite half
 * of the version gate.
 *
 * The gate (`middleware/version`) refuses a retired build on every request,
 * which is the enforcement; this is how the app finds out *before* it tries,
 * so it can put up a wall or knock once rather than show a member a failed
 * request. Both read the same two things, so they can never disagree: the
 * per-platform minimum in config, and the rows in `app_releases`.
 *
 * The ladder, in order:
 *   1. this exact build is `blocked`            → hard
 *   2. this version is below `app.minVersion`   → hard
 *   3. this version's row says `deprecated`     → soft
 *   4. a newer `current` release exists         → soft, where ⚙ nudgeOnNewer
 *   5. otherwise                                → none
 *
 * A blocked build is checked before the minimum so the reason is the true
 * one: "this build is broken" and "this version is too old" lead to the same
 * store page but are not the same fact, and the operator reading a log
 * should see which it was.
 */
export async function appUpdate(meta: {
  platform?: string;
  appVersion?: string;
  build?: string;
}): Promise<AppUpdate> {
  const config = await getConfig();
  const platform = meta.platform === 'ios' ? 'ios' : 'android';
  const version = meta.appVersion ?? '0.0.0';
  const build = meta.build ?? null;
  const minVersion = config.app.minVersion[platform];
  const storeUrl = config.app.storeUrl[platform];
  const words = config.app.update;

  const releases = await AppReleaseModel.find({ platform }).sort({ releasedAt: -1 }).lean();
  const current = releases.find(release => release.status === 'current') ?? null;
  // The newest release on file, whatever its status — what "latest" means to
  // a member, who cannot see our statuses.
  const newest = releases.reduce<typeof current>(
    (best, release) => (!best || compareVersions(release.version, best.version) > 0 ? release : best),
    current,
  );
  const latest = newest
    ? {
        version: newest.version,
        build: newest.build ?? null,
        releasedAt: newest.releasedAt?.toISOString() ?? null,
        notes: newest.notes ?? null,
      }
    : null;

  const mine = build ? releases.find(release => release.version === version && release.build === build) : undefined;
  const myVersion = releases.find(release => release.version === version);

  let status: AppUpdate['status'] = 'none';
  let reason: string | null = null;
  if (mine?.status === 'blocked') {
    status = 'hard';
    reason = 'blocked_build';
  } else if (compareVersions(version, minVersion) < 0) {
    status = 'hard';
    reason = 'below_min';
  } else if ((mine ?? myVersion)?.status === 'deprecated') {
    status = 'soft';
    reason = 'deprecated';
  } else if (words.nudgeOnNewer && current && compareVersions(version, current.version) < 0) {
    status = 'soft';
    reason = 'newer_available';
  }

  // The newest version there is to go to, for the wording. A build below the
  // minimum with no releases on file is still told what it needs.
  const target = latest?.version ?? minVersion;
  const fill = (text: string) =>
    text.replaceAll('{version}', version).replaceAll('{latest}', target).replaceAll('{min}', minVersion);

  const hard = status === 'hard';
  return appUpdateSchema.parse({
    status,
    installed: { version, build },
    latest,
    minVersion,
    storeUrl,
    title: hard ? fill(words.hardTitle) : fill(words.softTitle),
    message: hard ? fill(words.hardMessage) : fill(words.softMessage),
    actionLabel: fill(words.actionLabel),
    // A hard prompt has no way out, so it is not given one to draw.
    laterLabel: hard ? null : fill(words.laterLabel),
    dismissible: !hard,
    remindAfterHours: status === 'soft' ? words.remindAfterHours : null,
    reason,
  });
}
