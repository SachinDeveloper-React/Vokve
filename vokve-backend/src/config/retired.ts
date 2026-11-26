import { AppConfigModel } from '../modules/platform/models.js';
import { invalidateConfig } from './remote.js';

/**
 * Values an older build shipped as defaults, by key (D-112).
 *
 * `seed` writes a copy of every default into `app_config`, and a stored value
 * beats the code's — so a database seeded before a default changed keeps the
 * old one, silently. The move from the placeholder vokve.app to vokve.com is
 * exactly that: the code says vokve.com while the stored copy goes on handing
 * out links to a domain the company does not own.
 *
 * A key listed here whose stored value is still exactly one of these was
 * never chosen by anybody, so it is unpinned (`$unset`) and the current
 * default applies. Any other value is somebody's decision and is left alone.
 */
export const RETIRED_DEFAULTS: Record<string, readonly unknown[]> = {
  'support.email': ['support@vokve.app'],
  'support.links.privacy': ['https://vokve.app/privacy'],
  'support.links.terms': ['https://vokve.app/terms'],
  'support.links.licenses': ['https://vokve.app/licenses'],
  'support.links.website': ['https://vokve.app'],
  'commerce.trackingUrlTemplate': ['https://track.vokve.app/{ref}'],
  'app.storeUrl.android': ['https://play.google.com/store/apps/details?id=com.vokve'],
  // The Android package before `applicationId` became com.vokve.fitness.
  // Left pinned, every phone's key attestation and Play verdict is refused
  // as the wrong package.
  'integrity.android.packageName': ['com.vokve'],
};

/** A domain no current default uses: a stored value still naming it is worth a line in the report. */
const RETIRED_DOMAIN = /\bvokve\.app\b/;

export interface RetiredDefaultsReport {
  /** Keys that held a retired default — unpinned, or that would be on `apply`. */
  unpinned: { path: string; was: unknown }[];
  /** Keys still naming the retired domain with a value nobody shipped: left alone, for a person to look at. */
  kept: { path: string; value: unknown }[];
}

function leaves(value: unknown, prefix: string, out: [string, unknown][] = []): [string, unknown][] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      leaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.push([prefix, value]);
  }
  return out;
}

/**
 * Finds stored config still pinned to a retired default and, with `apply`,
 * unpins it. Idempotent: a second run finds nothing.
 */
export async function unpinRetiredDefaults(apply: boolean): Promise<RetiredDefaultsReport> {
  const report: RetiredDefaultsReport = { unpinned: [], kept: [] };
  const docs = await AppConfigModel.find().lean();

  for (const doc of docs) {
    const section = String(doc._id);
    const unset: Record<string, ''> = {};
    for (const [inner, value] of leaves(doc.value, '')) {
      if (inner === '') continue;
      const path = `${section}.${inner}`;
      const retired = RETIRED_DEFAULTS[path];
      if (retired?.some(old => JSON.stringify(old) === JSON.stringify(value))) {
        report.unpinned.push({ path, was: value });
        unset[`value.${inner}`] = '';
      } else if (JSON.stringify(value ?? null).match(RETIRED_DOMAIN)) {
        report.kept.push({ path, value });
      }
    }
    if (apply && Object.keys(unset).length > 0) {
      await AppConfigModel.updateOne({ _id: doc._id }, { $unset: unset });
    }
  }

  if (apply && report.unpinned.length > 0) invalidateConfig();
  return report;
}
