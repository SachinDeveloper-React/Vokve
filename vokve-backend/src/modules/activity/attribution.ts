import type { LayerName, SourceDecision, SourceStatus } from './layers.js';
import type { DeviceProof } from './rollup.service.js';

/**
 * Which source a day's steps came from.
 *
 * The scoring already decides it, device by device: `winner` is the Health
 * Connect source that answered for a phone, `shown` is the app that phone
 * was displaying when none of them was verified, and a day with neither is
 * the handset's own counter. But it decides it in pieces, spread through
 * `activity_daily.breakdown`, and nothing ever read them back — so the
 * question support is actually asked, *where did these steps come from*, had
 * no answer on any screen.
 *
 * This gathers that decision into one row per source. It invents nothing and
 * re-scores nothing: every figure here was written with the day, which is
 * what makes it the decision as it was made rather than a re-run under
 * today's config. Read by the two admin reads — `/admin/users/:id/steps` for
 * a window of days, `.../steps/timeline` for one day's hours.
 */

/** The handset's own step counter, which has no package name of its own. */
export const PHONE_SOURCE_KEY = 'phone';
export const PHONE_SOURCE_NAME = 'Phone step counter';

/** One device's part of `activity_daily.breakdown`, as `rollup.service.ts` writes it. */
export interface StoredDevice {
  deviceId: string;
  phone: { counted: number; recovered: number; flagged: number; clean: number };
  candidate: number;
  source: 'device' | 'health_connect';
  /** The Health Connect source that answered for this phone, by package name. */
  winner: string | null;
  /** What the phone showed, and which other app it came from; absent on days scored before D-51. */
  shown?: { steps: number; packageName: string | null };
  verified: boolean;
  verifiedSteps: number;
  displaySteps: number;
  plausibility: number;
  layers: Record<LayerName, number | null>;
  hard: string[];
  sources: SourceDecision[];
  sourcesStatus: string;
  signedAt: number;
  /** What vouched for the snapshot: the key that signed it and the Play verdict standing then. */
  proof: DeviceProof;
  /** The day cut to the time the account was signed in on the phone (D-56). */
  counting?: { window: [number, number][]; leftOut: number } | null;
}

/** `activity_daily.breakdown.union`: the phones added minute by minute (D-53); absent before it. */
export interface PhonesAdded {
  phones: number;
  verified: number;
  /** The union is what the day shows: more than any one phone answered. */
  added: boolean;
}

export interface StoredBreakdown {
  bestDeviceId: string;
  devices: StoredDevice[];
  union?: PhonesAdded;
}

/** What one source contributed to one day, across every phone that saw it. */
export interface DaySource {
  /** `phone` for the handset's own counter, else the app's package name. */
  key: string;
  appName: string;
  /** What the tracker called it — `self` for the phone's own counter. */
  kind: string;
  isWearable: boolean;
  isPlatform: boolean;
  /** The most any one phone saw it write for the day. */
  steps: number;
  /** Of that, what the rules let count; null when the tracker could not split it. */
  countable: number | null;
  manualSteps: number | null;
  /** `phone` for the handset's counter, else what became of the source (A14–A15). */
  status: SourceStatus | 'phone';
  /** This is where the day's own figure came from. */
  answered: boolean;
  /** Shown to the member and never verified — the day displays it, nothing pays for it (A11, A14). */
  shown: boolean;
  /** The phones that saw this source. */
  deviceIds: string[];
}

export interface DayAttribution {
  /** `device` or `health_connect`, as the day stored it. */
  source: string | null;
  /** The source the day's own figure came from; null on a day never scored. */
  answeredBy: DaySource | null;
  /** More than one phone's minutes added up to the day, so the counters are its source (D-53). */
  phonesAdded: boolean;
  bestDeviceId: string | null;
  /** Every source any phone saw that day, the answering one first. */
  sources: DaySource[];
}

/** The largest figure any phone reported, or null when none of them computed it. */
function largest(values: (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => typeof value === 'number');
  return known.length > 0 ? Math.max(...known) : null;
}

/**
 * The sources behind one stored day.
 *
 * Figures are taken as the **largest** any phone reported for a source, never
 * the sum: two phones on one account read the same Health Connect records, so
 * adding them would count one walk twice — which is the same reason the
 * scoring itself never adds two phones' counts.
 */
export function attributeDay(breakdown: StoredBreakdown | undefined, daySource: string | null): DayAttribution {
  const devices = breakdown?.devices ?? [];
  const best = devices.find(device => device.deviceId === breakdown?.bestDeviceId) ?? devices[0];
  const phonesAdded = breakdown?.union?.added ?? false;

  // The day's figure came from the phones' own counters when their minutes
  // were added, else from the source that won on the phone the day took,
  // else from the app that phone was showing, else from the phone itself.
  const shownPackage = best?.winner ? null : best?.shown?.packageName ?? null;
  const answeredKey = phonesAdded ? PHONE_SOURCE_KEY : best?.winner ?? shownPackage ?? PHONE_SOURCE_KEY;

  const phoneSteps = phonesAdded
    ? breakdown?.union?.phones ?? 0
    : Math.max(0, ...devices.map(device => device.phone?.counted ?? 0));

  const sources: DaySource[] = [];
  if (devices.length > 0) {
    sources.push({
      key: PHONE_SOURCE_KEY,
      appName: PHONE_SOURCE_NAME,
      kind: 'self',
      isWearable: false,
      isPlatform: false,
      steps: phoneSteps,
      countable: phoneSteps,
      manualSteps: 0,
      status: 'phone',
      answered: answeredKey === PHONE_SOURCE_KEY,
      shown: false,
      deviceIds: devices.map(device => device.deviceId),
    });
  }

  const byPackage = new Map<string, DaySource & { seen: SourceDecision[] }>();
  for (const device of devices) {
    for (const source of device.sources ?? []) {
      const row = byPackage.get(source.packageName);
      if (row) {
        row.seen.push(source);
        if (!row.deviceIds.includes(device.deviceId)) row.deviceIds.push(device.deviceId);
        // The status the day acted on is the one on the phone it took.
        if (device.deviceId === best?.deviceId) row.status = source.status;
        continue;
      }
      byPackage.set(source.packageName, {
        key: source.packageName,
        appName: source.appName || source.packageName,
        kind: source.kind,
        isWearable: source.isWearable,
        isPlatform: source.isPlatform,
        steps: 0,
        countable: null,
        manualSteps: null,
        status: source.status,
        answered: source.packageName === answeredKey,
        shown: source.packageName === shownPackage,
        deviceIds: [device.deviceId],
        seen: [source],
      });
    }
  }

  for (const row of byPackage.values()) {
    const { seen, ...source } = row;
    sources.push({
      ...source,
      steps: Math.max(0, ...seen.map(entry => entry.steps)),
      countable: largest(seen.map(entry => entry.countable)),
      manualSteps: largest(seen.map(entry => entry.manualSteps)),
    });
  }

  // The source the day took first, then by what it wrote: an operator reads
  // the answer before they read the field it was chosen from.
  sources.sort((a, b) => Number(b.answered) - Number(a.answered) || b.steps - a.steps);

  return {
    source: daySource,
    answeredBy: sources.find(source => source.answered) ?? null,
    phonesAdded,
    bestDeviceId: best?.deviceId ?? null,
    sources,
  };
}
