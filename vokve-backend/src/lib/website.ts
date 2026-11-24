import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * What became of asking the website to re-read its content:
 *
 *   - `done` — the site answered and will serve the new details at once;
 *   - `off` — `SITE_REVALIDATE_URL`/`SITE_REVALIDATE_SECRET` are not set,
 *     so the site picks the change up within the hour it caches for;
 *   - `failed` — it was asked and did not say yes; same hour applies.
 */
export type WebsiteRefresh = 'done' | 'off' | 'failed';

const TIMEOUT_MS = 4_000;

/**
 * Asks the public website (RULES P21) to drop its cached copy of the given
 * content tags at once — `immediate`, so not even the next visitor is shown
 * the old copy (a wrong number corrected should not be shown once more).
 * Never throws: the caller has already stored the change, and a site that
 * is down or slow must not turn a saved edit into an error on the panel.
 */
export async function refreshWebsite(tags: string[]): Promise<WebsiteRefresh> {
  const url = env.SITE_REVALIDATE_URL;
  const secret = env.SITE_REVALIDATE_SECRET;
  if (!url || !secret) return 'off';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tags, immediate: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return 'done';
    logger.warn({ status: response.status, tags }, 'website.refresh_refused');
    return 'failed';
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error), tags }, 'website.refresh_failed');
    return 'failed';
  }
}
