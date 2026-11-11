/**
 * Stands in for `zod/v4/locales/index.js` in the app's bundle (see
 * `metro.config.js`).
 *
 * zod re-exports every translation of its error messages as `z.locales` —
 * 64 files, about 280 KB — and Metro, which does not tree-shake, bundled
 * all of them for an app that only ever shows English, and whose messages
 * are mostly its own. English is the one zod itself registers by default,
 * and it imports that file directly, so nothing here changes what a failed
 * parse says.
 *
 * To show zod's messages in another language, export it from here beside
 * `en` and pass it to `z.config(z.locales.xx())`.
 */
export { default as en } from 'zod/v4/locales/en.js';
