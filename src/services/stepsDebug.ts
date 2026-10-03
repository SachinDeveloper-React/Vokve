import { Platform } from 'react-native';
import StepTracker, {
  type AnyHealthConnectRecord,
  type HealthConnectStatus,
  type StepSource,
  type StepTrackerConfig,
  type VerificationSnapshot,
} from 'react-native-step-tracker-pro';
import { config } from '../constants/config';
import { useStepsStore } from '../stores/stepsStore';
import { todayIso } from '../utils/date';
import { formatGrouped } from '../utils/format';
import { logger } from '../utils/logger';

/**
 * Today's steps as this phone sees them, written to the console: the phone
 * and its Android, the tracker's set-up, Health Connect's grants, every app
 * that wrote steps there and every raw record, which number is shown and
 * why, hour by hour, and what the server holds. For finding out why a
 * watch's steps do or do not show.
 *
 * Development builds only, and only while ⚙ `config.logStepSources` is on:
 * these are health data. Read-only — nothing here changes the tracker or the
 * store. Health Connect rate-limits every call, so a report reads it once
 * (twice when that read fails, to learn why) and runs at most once a minute.
 * It shows in React Native DevTools' console (`j` in Metro) and in
 * `adb logcat -s ReactNativeJS`.
 */

const SCOPE = 'steps:debug';
/** Lines per console entry: logcat cuts an entry off at about 4 KB. */
const LINES_PER_ENTRY = 25;
/** The least time between two reports. */
const MIN_GAP_MS = 60_000;

/** Android's version for an API level, for the header. */
const ANDROID: Record<number, string> = {
  28: '9',
  29: '10',
  30: '11',
  31: '12',
  32: '12L',
  33: '13',
  34: '14',
  35: '15',
  36: '16',
};

/** How Health Connect words a refusal for calling it too often. */
const RATE_LIMITED = /rate.?limit|quota/i;

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

/** One read; a failure is part of the report, never the end of it. */
async function read<T>(call: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: typeof code === 'string' ? `${code}: ${message}` : message,
    };
  }
}

/** The day's raw step records, or why there are none. */
interface RecordsRead {
  /** `'read'`, or the tracker's reason it did not read them. */
  status: string;
  records: AnyHealthConnectRecord[];
  truncated: boolean;
  /** What Health Connect itself said when asked directly; null when it was not. */
  error: string | null;
}

const n = formatGrouped;
const pad2 = (value: number) => String(value).padStart(2, '0');
const clock = (ms: number) => {
  const at = new Date(ms);
  return `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
};
const yesNo = (value: boolean | null | undefined) => (value ? 'yes' : 'no');
const names = (values: readonly string[] | null | undefined) =>
  values && values.length > 0 ? values.join(', ') : 'none';
/** `android.permission.health.READ_STEPS` → `READ_STEPS`. */
const short = (permission: string) =>
  permission.replace('android.permission.health.', '');
const cell = (value: number) => n(value).padStart(7);
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

const stepsAllowed = (status: HealthConnectStatus) =>
  status.stepsGranted ?? status.canReadSteps ?? status.canRead;

/** A source's 24 hours, when the tracker worked them out. */
const hoursOf = (source: StepSource) =>
  source.hourlySteps.length === 24 && source.hourlySteps.every(v => v >= 0)
    ? source.hourlySteps
    : null;

/** The API level this runs on; NaN off Android. */
const apiLevel = () =>
  Platform.OS === 'android' ? Number(Platform.Version) : Number.NaN;

/**
 * The report, a section per entry of lines. Separate from the logging so it
 * can be read in a test.
 */
export async function stepDebugReport(
  reason: string,
  now: number = Date.now(),
): Promise<string[][]> {
  const date = todayIso();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const [trackerConfig, snapshot] = await Promise.all([
    read(() => StepTracker.getConfig()),
    read(() =>
      StepTracker.getVerificationSnapshot(date, {
        include: ['minutes', 'healthConnectRecords'],
        healthConnectRecordTypes: ['steps'],
      }),
    ),
  ]);
  const records = await recordsOf(snapshot, dayStart.getTime(), now);
  // The grants as the app last read them: asking again would spend the
  // rate limit this report is often trying to explain.
  const health = useStepsStore.getState().healthConnect;
  const rateLimited =
    RATE_LIMITED.test(records.error ?? '') ||
    (!snapshot.ok && RATE_LIMITED.test(snapshot.error));

  const sections = [
    setupSection(reason, date, now, snapshot, trackerConfig, health),
  ];
  if (snapshot.ok) {
    sections.push(
      daySection(snapshot.value, trackerConfig, health, rateLimited),
      appsSection(snapshot.value),
      hoursSection(snapshot.value),
    );
  } else {
    sections.push([
      `Today: could not be read — ${snapshot.error}`,
      ...(rateLimited ? [`Why: ${RATE_LIMIT_WHY}`] : []),
    ]);
  }
  sections.push(
    recordsSection(
      records,
      snapshot.ok ? snapshot.value.sources : [],
      dayStart.getTime(),
      now,
    ),
    serverSection(date),
  );
  return sections;
}

/**
 * The day's records as the snapshot read them. When that read did not
 * happen the snapshot does not say why, so Health Connect is asked once
 * directly: the read either works or names the reason — rate limited,
 * denied. Only then, since each read spends the rate limit.
 */
async function recordsOf(
  snapshot: Read<VerificationSnapshot>,
  dayStart: number,
  now: number,
): Promise<RecordsRead> {
  const own = snapshot.ok ? snapshot.value.healthConnectRecords : undefined;
  if (own?.status === 'read') {
    return {
      status: 'read',
      records: own.records,
      truncated: own.truncated,
      error: null,
    };
  }
  if (own?.status === 'unavailable' || own?.status === 'disabled') {
    return { status: own.status, records: [], truncated: false, error: null };
  }
  const direct = await read(() =>
    StepTracker.getHealthConnectRecords(
      new Date(dayStart).toISOString(),
      new Date(Math.max(now, dayStart + 1)).toISOString(),
    ),
  );
  return direct.ok
    ? {
        status: 'read',
        records: direct.value.records,
        truncated: direct.value.truncated,
        error: null,
      }
    : {
        status: own?.status ?? 'failed',
        records: [],
        truncated: false,
        error: direct.error,
      };
}

function setupSection(
  reason: string,
  date: string,
  now: number,
  snapshot: Read<VerificationSnapshot>,
  trackerConfig: Read<StepTrackerConfig>,
  health: HealthConnectStatus | null,
): string[] {
  const api = apiLevel();
  const phone = snapshot.ok
    ? [
        snapshot.value.capabilities.manufacturer,
        snapshot.value.capabilities.model,
      ]
        .filter(Boolean)
        .join(' ')
    : '';
  const lines = [
    `══ Steps debug · ${reason} · ${date} ${clock(now)} ══`,
    `Phone: ${phone || 'unknown'} · ${
      Number.isFinite(api)
        ? `Android ${ANDROID[api] ?? '?'} (API ${api})`
        : `${Platform.OS} ${Platform.Version}`
    }`,
  ];
  if (trackerConfig.ok) {
    const c = trackerConfig.value;
    const reads =
      c.healthConnectEnabled === false || c.healthConnectReadEnabled === false
        ? 'OFF'
        : 'on';
    lines.push(
      `Tracker: policy ${c.stepSource ?? 'auto'} · wearable trust ${
        c.wearableTrust ?? 'metadata'
      } · watch relays [${names(c.wearableAllowlist)}] · pinned app ${
        c.preferredStepSourcePackage ?? 'none'
      }`,
      `Health Connect reads: ${reads} · types [${names(
        c.healthConnectReadTypes,
      )}] · typed-in steps left out: ${yesNo(
        c.healthConnectIgnoreManualEntries,
      )}`,
    );
  } else {
    lines.push(`Tracker config: could not be read — ${trackerConfig.error}`);
  }
  lines.push(
    health
      ? `Health Connect, as the app last read it: ${
          health.availability
        } · steps allowed: ${yesNo(stepsAllowed(health))} · granted [${names(
          health.grantedPermissions.map(short),
        )}] · missing [${names(
          health.missingPermissions.map(short),
        )}] · not in the manifest [${names(
          health.undeclaredPermissions.map(short),
        )}]`
      : 'Health Connect: not read by the app yet',
  );
  return lines;
}

function daySection(
  snapshot: VerificationSnapshot,
  trackerConfig: Read<StepTrackerConfig>,
  health: HealthConnectStatus | null,
  rateLimited: boolean,
): string[] {
  const shown = snapshot.resolved;
  const since =
    snapshot.coverageStartAt > 0 ? clock(snapshot.coverageStartAt) : 'midnight';
  const from = shown.usedExternal
    ? shown.merged
      ? `${shown.appName} (the phone's count + the ${n(
          shown.baselineSteps,
        )} it was ahead)`
      : shown.appName
    : 'this phone';
  return [
    `Phone sensor (${snapshot.sensor}): ${n(
      snapshot.deviceSteps,
    )} steps today, counting since ${since} · added after a gap ${n(
      snapshot.recoveredSteps,
    )} · flagged ${n(snapshot.suspectSteps)}`,
    `Shown: ${n(shown.steps)} from ${from} · best other app ${n(
      shown.externalSteps,
    )}${
      shown.manualStepsExcluded > 0
        ? ` · typed-in left out ${n(shown.manualStepsExcluded)}`
        : ''
    }`,
    `Why: ${
      rateLimited ? RATE_LIMIT_WHY : why(snapshot, trackerConfig, health)
    }`,
  ];
}

const RATE_LIMIT_WHY =
  'Health Connect is refusing Vokve\'s calls: its rate limit is used up ("quota has been exceeded") — too many calls in a short time. Nothing can be read until it refills. Leave Vokve closed for 15 minutes, then open it once. Until then the tracker may also say steps are not allowed: on Android 13 and older even the permission check is rate-limited, and a refused check reads as "nothing granted".';

/** Why the number shown is what it is, from the first rule that decided it. */
function why(
  snapshot: VerificationSnapshot,
  trackerConfig: Read<StepTrackerConfig>,
  health: HealthConnectStatus | null,
): string {
  if (health) {
    if (health.availability !== 'available') {
      return `Health Connect is ${health.availability} on this phone, so only the phone's own count can be shown.`;
    }
    if (!stepsAllowed(health)) {
      const api = apiLevel();
      return `Vokve is not allowed to read steps from Health Connect. Connect it on the Step Tracking screen.${
        Number.isFinite(api) && api < 34
          ? ' If Health Connect\'s own app lists Vokve as allowed, this is its rate limit instead: on Android 13 and older even the permission check is rate-limited, and a refused check reads as "nothing granted". Wait 15 minutes rather than connecting again.'
          : ''
      }`;
    }
  }
  const c = trackerConfig.ok ? trackerConfig.value : null;
  if (
    c &&
    (c.healthConnectEnabled === false ||
      c.healthConnectReadEnabled === false ||
      c.stepSource === 'device')
  ) {
    return 'The tracker is set not to read Health Connect for the number.';
  }
  if (snapshot.sourcesStatus && snapshot.sourcesStatus !== 'read') {
    return `Health Connect was not read this time (${snapshot.sourcesStatus}).`;
  }
  const others = snapshot.sources.filter(source => !source.isSelf);
  if (others.length === 0) {
    return 'No other app wrote steps to Health Connect today.';
  }
  const shown = snapshot.resolved;
  if (shown.usedExternal) {
    return shown.merged
      ? `${shown.appName} counted more than the phone, so the steps it was ahead by are kept on top of the phone's count.`
      : `${shown.appName} counted more than the phone, so its count is shown.`;
  }
  // As the tracker compares them: typed-in steps out first, when it leaves
  // them out, then the app with the most.
  const typedOut = c?.healthConnectIgnoreManualEntries !== false;
  const counted = (source: StepSource) =>
    source.steps - (typedOut ? Math.max(0, source.manualSteps) : 0);
  const best = others.reduce((a, b) => (counted(b) > counted(a) ? b : a));
  const phone = snapshot.deviceSteps;
  if (counted(best) <= phone) {
    return counted(best) < best.steps
      ? `${best.appName} has ${n(best.steps)}, but ${n(
          best.steps - counted(best),
        )} were typed in by hand and are left out; the rest is not more than the phone's ${n(
          phone,
        )}.`
      : `${best.appName} has ${n(best.steps)}, not more than the phone's ${n(
          phone,
        )}. Apps are never added together — the higher count is shown — so steps only the watch saw add nothing while the phone's total is higher. See "by hour" below.`;
  }
  if (!best.trustedWearable) {
    const trusted = others.find(
      source =>
        source !== best && source.trustedWearable && counted(source) > phone,
    );
    return trusted
      ? `${best.appName} has the most (${n(
          best.steps,
        )}) and is not trusted as a watch, so the phone's count stands. ${
          trusted.appName
        } (${n(
          trusted.steps,
        )}) is trusted but not looked at: only the app with the most steps is compared.`
      : `${best.appName} has more than the phone (${n(
          best.steps,
        )}) but is not trusted as a watch — not in the tracker's catalog or the watch relays — so it can only fill the time before the phone started counting today.`;
  }
  return `${best.appName} has more than the phone (${n(
    best.steps,
  )}) and is trusted, yet the phone's count is shown. Read it again in a minute: the tracker keeps today's apps for 30 seconds.`;
}

function appsSection(snapshot: VerificationSnapshot): string[] {
  const lines = [
    `Apps with steps in Health Connect today (${
      snapshot.sources.length
    }) — read status: ${snapshot.sourcesStatus ?? 'unknown'}:`,
  ];
  if (snapshot.sources.length === 0) {
    lines.push('  (none)');
  }
  snapshot.sources.forEach((source, index) => {
    const m = source.recordingMethods;
    const recorded = m
      ? `active ${n(m.active)}, automatic ${n(m.automatic)}, typed in ${n(
          m.manual,
        )}, not stated ${n(m.unknown)}`
      : 'not split';
    const tags = [
      source.isSelf ? 'this app' : null,
      source.isPlatform ? "Android's own count" : null,
    ].filter(Boolean);
    lines.push(
      `  ${index + 1}. ${source.appName} (${source.packageName})${
        tags.length > 0 ? ` [${tags.join(', ')}]` : ''
      }`,
      `     ${n(source.steps)} steps · kind ${
        source.kind
      } · trusted as a watch ${yesNo(
        source.trustedWearable,
      )} · recorded: ${recorded} · written late ${
        source.lateWrittenSteps >= 0 ? n(source.lateWrittenSteps) : '?'
      } · distance ${n(source.distance)} m (${
        source.distanceSource ?? '?'
      }) · last record ${
        source.lastRecordAt > 0 ? clock(source.lastRecordAt) : '?'
      }`,
    );
  });
  return lines;
}

function hoursSection(snapshot: VerificationSnapshot): string[] {
  const phone = Array.from({ length: 24 }, () => 0);
  for (const minute of snapshot.minutes ?? []) {
    phone[new Date(minute.minuteStart).getHours()] +=
      minute.steps + minute.untimedSteps;
  }
  const apps = snapshot.sources
    .filter(source => !source.isSelf)
    .map(source => ({ source, hours: hoursOf(source) }))
    .filter(
      (app): app is { source: StepSource; hours: number[] } =>
        app.hours !== null,
    );

  const lines = [
    `By hour — phone${apps.map(app => ` | ${app.source.appName}`).join('')}:`,
  ];
  if (snapshot.minutesStatus !== 'enabled') {
    lines.push(
      "  (the phone's minutes are not recorded — fraud detection is off — so its column is empty)",
    );
  }
  for (let hour = 0; hour < 24; hour += 1) {
    const counts = apps.map(app => app.hours[hour]);
    if (phone[hour] === 0 && counts.every(count => count === 0)) continue;
    const ahead = counts.some(count => count > phone[hour]);
    lines.push(
      `  ${pad2(hour)}:00 ${cell(phone[hour])}${counts
        .map(count => ` |${cell(count)}`)
        .join('')}${ahead ? '  ← more than the phone' : ''}`,
    );
  }
  lines.push(
    `  total ${cell(sum(phone))}${apps
      .map(app => ` |${cell(sum(app.hours))}`)
      .join('')}`,
  );
  if (sum(phone) !== snapshot.deviceSteps) {
    lines.push(
      `  (the phone's minutes add up to ${n(sum(phone))}; its total is ${n(
        snapshot.deviceSteps,
      )})`,
    );
  }
  for (const app of apps) {
    if (app.source.isPlatform) continue;
    const union = sum(
      app.hours.map((count, hour) => Math.max(count, phone[hour])),
    );
    const more = union - snapshot.resolved.steps;
    lines.push(
      `  The phone and ${
        app.source.appName
      }, the higher of the two each hour: ${n(union)}${
        more > 0 ? ` — ${n(more)} more than shown` : ''
      }`,
    );
  }
  if (apps.length === 0) {
    lines.push('  (no app has hours for today)');
  }
  return lines;
}

function recordsSection(
  records: RecordsRead,
  sources: StepSource[],
  dayStart: number,
  now: number,
): string[] {
  const head = `Raw step records in Health Connect today, 00:00 → ${clock(
    now,
  )}`;
  if (records.status !== 'read') {
    return [`${head}: not read — ${records.error ?? records.status}`];
  }
  const appName = new Map(
    sources.map(source => [source.packageName, source.appName]),
  );
  const nameOf = (pkg: string) => appName.get(pkg) ?? pkg;
  const list = [...records.records].sort((a, b) => a.startTime - b.startTime);
  const lines = [
    `${head} (${list.length}${records.truncated ? ', more not read' : ''}):`,
  ];
  if (list.length === 0) {
    lines.push('  (none)');
  }
  const byApp = new Map<string, number>();
  for (const record of list) {
    const count = 'count' in record ? record.count : 0;
    const device = record.device
      ? [record.device.type, record.device.manufacturer, record.device.model]
          .filter(Boolean)
          .join(' ')
      : 'no device';
    const flags = [
      record.startTime < dayStart ? 'started before today' : null,
      record.endTime > now ? 'ends after now' : null,
    ].filter(Boolean);
    lines.push(
      `  ${clock(record.startTime)}–${clock(record.endTime)} ${n(
        count,
      ).padStart(6)}  ${nameOf(record.packageName)}  ${
        record.recordingMethod
      }  ${device}${flags.length > 0 ? `  [${flags.join(', ')}]` : ''}`,
    );
    byApp.set(record.packageName, (byApp.get(record.packageName) ?? 0) + count);
  }
  if (byApp.size > 0) {
    lines.push(
      `  By app: ${[...byApp]
        .map(([pkg, count]) => `${nameOf(pkg)} ${n(count)}`)
        .join(' · ')}`,
    );
  }
  return lines;
}

function serverSection(date: string): string[] {
  const state = useStepsStore.getState();
  const day =
    state.serverWeek.find(entry => entry.date === date) ??
    state.serverDays[date];
  const mark = state.synced[date];
  return [
    day
      ? `Server (what the dashboard shows) today: ${n(day.steps)} steps · ${n(
          day.verifiedSteps,
        )} verified · source ${day.source ?? 'none'} · verified ${yesNo(
          day.verified,
        )}`
      : 'Server (what the dashboard shows) today: nothing yet',
    `Sync: ${state.syncStatus}${
      state.syncError ? ` — ${state.syncError}` : ''
    } · days waiting [${names(state.queue)}] · today last sent: ${
      mark
        ? `${n(mark.steps)} steps, best other app ${
            mark.externalSteps === undefined ? '?' : n(mark.externalSteps)
          }, at ${clock(mark.at)}`
        : 'never'
    }`,
  ];
}

let running: Promise<void> | null = null;
let lastStartedAt = Number.NEGATIVE_INFINITY;

/**
 * Writes the report to the console. One at a time, so two never
 * interleave, and one a minute at most; never throws, and does nothing
 * outside a development build.
 */
export function logStepDebug(reason: string): Promise<void> {
  if (!__DEV__ || !config.logStepSources) {
    return Promise.resolve();
  }
  if (running) {
    return running;
  }
  const now = Date.now();
  if (now - lastStartedAt < MIN_GAP_MS) {
    logger.info(
      SCOPE,
      `(${reason}: no report — the last was ${Math.round(
        (now - lastStartedAt) / 1000,
      )} s ago; one a minute at most, to spare Health Connect's rate limit)`,
    );
    return Promise.resolve();
  }
  lastStartedAt = now;
  running = stepDebugReport(reason, now)
    .then(sections => {
      for (const section of sections) {
        for (let i = 0; i < section.length; i += LINES_PER_ENTRY) {
          logger.info(SCOPE, section.slice(i, i + LINES_PER_ENTRY).join('\n'));
        }
      }
    })
    .catch(error => logger.warn(SCOPE, 'Step debug report failed', error))
    .finally(() => {
      running = null;
    });
  return running;
}
