import fs from 'node:fs';
import { env } from './env.js';

/**
 * Google service-account credentials, resolved from the environment.
 *
 * A service-account JSON is a private key with a filename. Keeping it as a
 * file means the secret has to travel to every box as a file, land in the
 * right path, and be excluded from the repo by hand — three chances to get
 * it wrong, and nowhere for a hosting panel (Vercel, Render, a container's
 * `--env-file`) to put it. So the keys themselves live in the environment
 * alongside every other credential this server holds, and the file is only
 * the copy a developer keeps on their own laptop.
 *
 * Three forms are accepted, in this order:
 *
 *  1. The discrete keys — `<NAME>_PROJECT_ID`, `<NAME>_CLIENT_EMAIL`,
 *     `<NAME>_PRIVATE_KEY`. This is the form to use: three values a
 *     dashboard can hold, and the only secret among them is the key.
 *  2. The whole JSON in `<NAME>_SERVICE_ACCOUNT`.
 *  3. A path to the JSON in that same variable.
 *
 * (2) and (3) are kept so an existing deployment — and the service-account
 * file still sitting in `secrets/` — keeps working untouched.
 */

/** The fields of a service account this server uses, in the JSON's own spelling. */
export interface ServiceAccountCredential {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Which credential is wanted — the prefix its variables carry. */
export type ServiceAccountName = 'FIREBASE' | 'PLAY_INTEGRITY';

/** Blank counts as absent: the test setup empties these rather than deleting them. */
function set(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function varsFor(name: ServiceAccountName) {
  const v =
    name === 'FIREBASE'
      ? {
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: env.FIREBASE_PRIVATE_KEY,
          jsonOrPath: env.FIREBASE_SERVICE_ACCOUNT,
        }
      : {
          projectId: env.PLAY_INTEGRITY_PROJECT_ID,
          clientEmail: env.PLAY_INTEGRITY_CLIENT_EMAIL,
          privateKey: env.PLAY_INTEGRITY_PRIVATE_KEY,
          jsonOrPath: env.PLAY_INTEGRITY_SERVICE_ACCOUNT,
        };
  return {
    projectId: set(v.projectId),
    clientEmail: set(v.clientEmail),
    privateKey: set(v.privateKey),
    jsonOrPath: set(v.jsonOrPath),
  };
}

/**
 * A PEM key does not survive a single-line value intact: `.env` files and
 * hosting panels alike carry it with literal `\n` sequences, and a panel
 * will happily keep the quotes that were pasted around it. Both come back as
 * the real newlines `crypto` needs to read the key.
 *
 * The result is canonical PEM — no surrounding whitespace, one closing
 * newline — whichever of the three forms it arrived in, so a key pasted into
 * a dashboard and the same key read out of a file are the same string.
 */
function normalisePrivateKey(key: string): string {
  const pem = key
    .replace(/^(['"])([\s\S]*)\1$/, '$2')
    .replace(/\\n/g, '\n')
    .trim();
  return `${pem}\n`;
}

/**
 * Whether this credential is configured at all. Answers without reading a
 * file or loading an SDK, so a box with no credentials never pays for one.
 */
export function hasServiceAccount(name: ServiceAccountName): boolean {
  const v = varsFor(name);
  return Boolean(v.projectId || v.clientEmail || v.privateKey || v.jsonOrPath);
}

/**
 * The credential, or `null` when nothing is configured. Throws when what is
 * configured cannot be used — a half-filled set of keys, an unreadable file,
 * malformed JSON — because a deployment that meant to have push and silently
 * does not is worse than one that says so. Every caller builds its client at
 * boot inside a `try`, so a throw here is logged and leaves the feature off
 * rather than killing the process.
 */
export function resolveServiceAccount(name: ServiceAccountName): ServiceAccountCredential | null {
  const { projectId, clientEmail, privateKey, jsonOrPath } = varsFor(name);

  const discrete = { PROJECT_ID: projectId, CLIENT_EMAIL: clientEmail, PRIVATE_KEY: privateKey };
  const missing = Object.entries(discrete)
    .filter(([, value]) => !value)
    .map(([key]) => `${name}_${key}`);
  if (missing.length === 0) {
    return {
      project_id: projectId!,
      client_email: clientEmail!,
      private_key: normalisePrivateKey(privateKey!),
    };
  }
  // Some of the three, but not all: say which are missing instead of falling
  // back and leaving the operator to guess why their keys were ignored.
  if (missing.length < 3) {
    throw new Error(`${name} service account is incomplete: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set`);
  }

  if (!jsonOrPath) return null;
  const json = jsonOrPath.startsWith('{') ? jsonOrPath : fs.readFileSync(jsonOrPath, 'utf8');
  const parsed = JSON.parse(json) as Partial<ServiceAccountCredential>;
  const source = jsonOrPath.startsWith('{') ? `${name}_SERVICE_ACCOUNT` : jsonOrPath;
  for (const field of ['project_id', 'client_email', 'private_key'] as const) {
    if (!parsed[field]) throw new Error(`${source} is not a service account: no "${field}"`);
  }
  return {
    project_id: parsed.project_id!,
    client_email: parsed.client_email!,
    private_key: normalisePrivateKey(parsed.private_key!),
  };
}
