import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { hasServiceAccount, resolveServiceAccount } from '../src/config/serviceAccount.js';

/**
 * The credentials come out of the environment, so the thing worth testing is
 * every shape the environment can hand them over in — above all a PEM key
 * squeezed onto one line, which is how a `.env` file and a hosting panel both
 * carry it, and which is useless to `crypto` until the newlines come back.
 */

// A real PEM, so "is this key usable" is a question the test can actually ask.
const PEM = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEAwf0nF0lD1pZ2kWxH',
  '-----END PRIVATE KEY-----',
  '',
].join('\n');

const FIREBASE_VARS = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_SERVICE_ACCOUNT',
] as const;

/** `test/setup.ts` empties all four; put them back that way. */
function clear(): void {
  Object.assign(env, Object.fromEntries(FIREBASE_VARS.map(k => [k, ''])));
}

afterEach(clear);

describe('service account resolution', () => {
  it('is absent when nothing is set, and asks for nothing', () => {
    clear();
    expect(hasServiceAccount('FIREBASE')).toBe(false);
    expect(resolveServiceAccount('FIREBASE')).toBeNull();
  });

  it('builds the credential from the three keys', () => {
    clear();
    Object.assign(env, {
      FIREBASE_PROJECT_ID: 'vokve-test',
      FIREBASE_CLIENT_EMAIL: 'push@vokve-test.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: PEM,
    });
    expect(hasServiceAccount('FIREBASE')).toBe(true);
    expect(resolveServiceAccount('FIREBASE')).toEqual({
      project_id: 'vokve-test',
      client_email: 'push@vokve-test.iam.gserviceaccount.com',
      private_key: PEM,
    });
  });

  it('puts the newlines back into a key carried on one line', () => {
    clear();
    Object.assign(env, {
      FIREBASE_PROJECT_ID: 'vokve-test',
      FIREBASE_CLIENT_EMAIL: 'push@vokve-test.iam.gserviceaccount.com',
      // What a dashboard stores: one line, escaped newlines, quotes kept.
      FIREBASE_PRIVATE_KEY: `"${PEM.replace(/\n/g, '\\n')}"`,
    });
    expect(resolveServiceAccount('FIREBASE')!.private_key).toBe(PEM);
  });

  it('refuses a half-filled set of keys instead of ignoring it', () => {
    clear();
    Object.assign(env, { FIREBASE_PROJECT_ID: 'vokve-test' });
    // The operator meant to configure push; silence would be the wrong answer.
    expect(hasServiceAccount('FIREBASE')).toBe(true);
    expect(() => resolveServiceAccount('FIREBASE')).toThrow(/FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY are not set/);
  });

  it('still accepts the whole JSON in one variable', () => {
    clear();
    Object.assign(env, {
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
        project_id: 'vokve-test',
        client_email: 'push@vokve-test.iam.gserviceaccount.com',
        private_key: PEM,
      }),
    });
    expect(resolveServiceAccount('FIREBASE')).toMatchObject({ project_id: 'vokve-test', private_key: PEM });
  });

  it('still accepts a path to the file', () => {
    clear();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vokve-sa-')), 'sa.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        project_id: 'vokve-test',
        client_email: 'push@vokve-test.iam.gserviceaccount.com',
        private_key: PEM,
      }),
    );
    Object.assign(env, { FIREBASE_SERVICE_ACCOUNT: file });
    expect(resolveServiceAccount('FIREBASE')).toMatchObject({ project_id: 'vokve-test', private_key: PEM });
  });

  it('prefers the three keys over the file', () => {
    clear();
    Object.assign(env, {
      FIREBASE_PROJECT_ID: 'from-env',
      FIREBASE_CLIENT_EMAIL: 'push@vokve-test.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: PEM,
      FIREBASE_SERVICE_ACCOUNT: '/nonexistent/sa.json',
    });
    expect(resolveServiceAccount('FIREBASE')!.project_id).toBe('from-env');
  });

  it('says so when the JSON is not a service account', () => {
    clear();
    Object.assign(env, { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'vokve-test' }) });
    expect(() => resolveServiceAccount('FIREBASE')).toThrow(/no "client_email"/);
  });

  it('keeps the Play Integrity keys separate from the Firebase ones', () => {
    clear();
    Object.assign(env, {
      FIREBASE_PROJECT_ID: 'vokve-test',
      FIREBASE_CLIENT_EMAIL: 'push@vokve-test.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: PEM,
    });
    expect(hasServiceAccount('PLAY_INTEGRITY')).toBe(false);
  });
});
