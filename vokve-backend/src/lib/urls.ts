import { env } from '../config/env.js';

/**
 * Which URLs the API will store where another screen will load them
 * (RULES P10, Z8).
 *
 * `z.string().url()` alone takes anything `new URL` can parse —
 * `javascript:alert(1)`, `data:text/html,…`, or an address on a server the
 * member runs. A profile photo is loaded by every phone that shows the
 * leaderboard and by the operator's panel, so an avatar pointing at a
 * stranger's server hands them the address of everybody who looked.
 */

/** http(s) only: no script, data, file or app schemes. */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * A photo a member may set on their own profile: one this API serves (what
 * `POST /me/avatar` hands back), or the Google profile photo a Google
 * sign-in brought with it. Anything else is uploaded, not linked.
 */
export function isAvatarUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const own = new URL(env.PUBLIC_BASE_URL);
  if (url.host === own.host && url.protocol === own.protocol) return url.pathname.startsWith('/v1/media/');
  return url.protocol === 'https:' && (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'));
}
