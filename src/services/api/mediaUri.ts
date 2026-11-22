import { config } from '../../constants/config';

/** An image the API serves itself — today the avatars `POST /me/avatar` stores. */
const OWN_MEDIA = /^https?:\/\/[^/?#]+(\/v1\/media\/.*)$/i;
const ORIGIN = /^https?:\/\/[^/?#]+/i;

/**
 * The address this phone loads a server-hosted image from.
 *
 * The API stores media URLs absolute, built from its `PUBLIC_BASE_URL`,
 * and on a development machine that is the default `http://localhost:3000`.
 * The iOS simulator can open that, because there localhost is the Mac. An
 * Android phone or emulator cannot: there localhost is the phone itself, so
 * every uploaded avatar failed to load and the disc stayed empty. The
 * server cannot fix this, because it does not know which address each
 * device uses to reach it.
 *
 * So a development build loads the API's own media from the address it
 * already reaches the API at (`config.apiBaseUrl`, i.e. `LOCAL_API_HOST`).
 * This also keeps photos stored under an older LAN address loading after
 * the Mac's IP changes. A release build uses the URL exactly as the server
 * wrote it: there `PUBLIC_BASE_URL` is the public address, and so is the
 * API's.
 *
 * Other images (a Google profile photo, a CDN-hosted product picture) are
 * left unchanged.
 */
export function mediaUri(uri: string): string {
  if (!__DEV__) {
    return uri;
  }
  const own = OWN_MEDIA.exec(uri);
  const apiOrigin = ORIGIN.exec(config.apiBaseUrl)?.[0];
  return own && apiOrigin ? `${apiOrigin}${own[1]}` : uri;
}
