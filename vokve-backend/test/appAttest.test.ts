import { X509Certificate, createHash, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import request from 'supertest';
import { OctetString } from '@peculiar/asn1-schema';
import { Extension } from '@peculiar/asn1-x509';
import { afterEach, describe, expect, it } from 'vitest';
import { invalidateConfig } from '../src/config/remote.js';
import { localDayOf } from '../src/lib/dates.js';
import { decodeCbor, verifyAppAttestation, type AppAttestExpectations } from '../src/lib/attestation/appAttest.js';
import { ActivityDailyModel } from '../src/modules/activity/models.js';
import { DeviceModel } from '../src/modules/devices/models.js';
import { FraudFlagModel } from '../src/modules/integrity/models.js';
import { setAppAttestRoot } from '../src/modules/integrity/service.js';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { makeCa, makeCertificate, signSnapshot, snapshotPayload, type TestCa, type TestKey } from './attestation.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

/**
 * iOS (react-native-step-tracker-pro-ios): a Secure Enclave key that Apple's
 * App Attest vouches for, through client data `challenge|keyId`. A test
 * cannot get Apple to sign anything, so a stand-in root issues the
 * credential certificate, carrying the nonce extension the way Apple's do.
 */

const TEAM_ID = 'ZL38K343UT';
const BUNDLE_ID = 'com.vokve.fitness';

const sha256 = (...parts: (Buffer | string)[]) =>
  createHash('sha256').update(Buffer.concat(parts.map(part => Buffer.from(part)))).digest();

/** Just enough CBOR to build an attestation object. */
function cbor(value: Buffer | string | unknown[] | Record<string, unknown>): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  };
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') {
    const s = Buffer.from(value);
    return Buffer.concat([head(3, s.length), s]);
  }
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(v => cbor(v as Buffer))]);
  const keys = Object.keys(value);
  return Buffer.concat([head(5, keys.length), ...keys.flatMap(k => [cbor(k), cbor(value[k] as Buffer)])]);
}

const pem = (der: Buffer) => new X509Certificate(der).toString();

interface IosKey {
  /** What the iPhone posts to `POST /devices/:id/attestation`. */
  attestation: TestKey['attestation'] & {
    appAttest: { keyId: string; attestationObject: string; clientData: string; environment: 'production' | 'development' };
  };
  signing: TestKey;
}

/** What `attestDevice(challenge)` returns on an iPhone, with `ca` standing in for Apple. */
function attestIphone(
  ca: TestCa,
  challenge: string,
  options: { environment?: 'production' | 'development'; bundleId?: string; counter?: number } = {},
): IosKey {
  const environment = options.environment ?? 'production';
  const signing = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingSpki = signing.publicKey.export({ format: 'der', type: 'spki' });
  const signingKeyId = createHash('sha256').update(signingSpki).digest('hex');

  const credential = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credSpki = credential.publicKey.export({ format: 'der', type: 'spki' });
  const appKeyId = sha256(credSpki.subarray(credSpki.length - 65));
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(options.counter ?? 0);
  const aaguid = environment === 'production'
    ? Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)])
    : Buffer.from('appattestdevelop');
  const authData = Buffer.concat([
    sha256(`${TEAM_ID}.${options.bundleId ?? BUNDLE_ID}`), Buffer.from([0x40]), counter, aaguid,
    Buffer.from([0x00, 0x20]), appKeyId,
  ]);
  const clientData = `${challenge}|${signingKeyId}`;
  const nonce = sha256(authData, sha256(clientData));
  const leaf = makeCertificate({
    subject: 'App Attest credential', issuer: 'Test Attestation CA', subjectKey: credential.publicKey,
    issuerKey: ca.intermediateKey, serial: 7,
    extensions: [new Extension({
      extnID: '1.2.840.113635.100.8.2', critical: false,
      extnValue: new OctetString(Buffer.concat([Buffer.from('3024a1220420', 'hex'), nonce])),
    })],
  });
  const attestationObject = cbor({
    fmt: 'apple-appattest',
    attStmt: { x5c: [leaf, ca.intermediateCert], receipt: Buffer.from('receipt') },
    authData,
  }).toString('base64');

  return {
    attestation: {
      keyId: signingKeyId,
      algorithm: 'SHA256withECDSA',
      publicKey: signingSpki.toString('base64'),
      certificateChain: [],
      attested: true,
      securityLevel: 'secure_enclave',
      createdAt: Date.now(),
      appAttest: { keyId: appKeyId.toString('base64'), attestationObject, clientData, environment },
    },
    signing: {
      privateKey: signing.privateKey as KeyObject,
      attestation: {
        keyId: signingKeyId, algorithm: 'SHA256withECDSA', publicKey: signingSpki.toString('base64'),
        certificateChain: [], attested: true, securityLevel: 'secure_enclave', createdAt: Date.now(),
      },
    },
  };
}

afterEach(() => {
  setAppAttestRoot(null);
});

describe('App Attest verification (iOS, RULES A2)', () => {
  const ca = makeCa();
  const expectations = (overrides: Partial<AppAttestExpectations> = {}): AppAttestExpectations => ({
    challenge: 'challenge-1', teamId: TEAM_ID, bundleId: BUNDLE_ID, environments: ['production'],
    rootPem: pem(ca.rootCert), ...overrides,
  });
  const input = (key: IosKey) => ({
    attestationObject: key.attestation.appAttest.attestationObject,
    keyId: key.attestation.appAttest.keyId,
    clientData: key.attestation.appAttest.clientData,
    signingPublicKey: key.attestation.publicKey,
  });

  it('reads the CBOR an attestation object is made of', () => {
    expect(decodeCbor(cbor({ a: ['x', Buffer.from([1, 2])] }))).toEqual({ a: ['x', Buffer.from([1, 2])] });
  });

  it('accepts a genuine attestation and names the signing key it binds', () => {
    const key = attestIphone(ca, 'challenge-1');
    const result = verifyAppAttestation(input(key), expectations());
    expect(result.signingKeyId).toBe(key.attestation.keyId);
    expect(result.environment).toBe('production');
    expect(result.credentialPublicKey).toMatch(/BEGIN PUBLIC KEY/);
  });

  it('refuses a replay, another app, a used key, the wrong environment and a foreign root', () => {
    const key = attestIphone(ca, 'challenge-1');
    expect(() => verifyAppAttestation(input(key), expectations({ challenge: 'an-old-one' }))).toThrow(/clientData/);
    expect(() => verifyAppAttestation(input(attestIphone(ca, 'challenge-1', { bundleId: 'com.other' })), expectations()))
      .toThrow(/rpIdHash/);
    expect(() => verifyAppAttestation(input(attestIphone(ca, 'challenge-1', { counter: 3 })), expectations())).toThrow(/counter/);
    expect(() => verifyAppAttestation(input(attestIphone(ca, 'challenge-1', { environment: 'development' })), expectations()))
      .toThrow(/aaguid/);
    expect(() => verifyAppAttestation(input(key), expectations({ rootPem: pem(makeCa().rootCert) }))).toThrow(/issued/);
    // The signing key swapped for another after Apple attested the first.
    const other = attestIphone(ca, 'challenge-1');
    expect(() => verifyAppAttestation({ ...input(key), signingPublicKey: other.attestation.publicKey }, expectations()))
      .toThrow(/clientData/);
  });
});

describe('an iPhone through the real routes', () => {
  const ca = makeCa();

  async function attestedIphone(): Promise<{ session: Session; key: IosKey }> {
    setAppAttestRoot(pem(ca.rootCert));
    const session = await signUpAndRegister();
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { platform: 'ios' } });
    const issued = await request(app).post(`/v1/devices/${session.deviceId}/attestation/challenge`).set(authed(session));
    const key = attestIphone(ca, issued.body.challenge);
    const res = await request(app).post(`/v1/devices/${session.deviceId}/attestation`).set(authed(session)).send(key.attestation);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ attested: true, securityLevel: 'secure_enclave' });
    return { session, key };
  }

  it('keeps an attested Secure Enclave key, with the credential for later', async () => {
    const { session, key } = await attestedIphone();
    const device = await DeviceModel.findById(session.deviceId, { attestation: 1 }).lean();
    expect(device?.attestation).toMatchObject({
      keyId: key.attestation.keyId, attested: true, provider: 'app_attest', failure: null,
      appAttest: { keyId: key.attestation.appAttest.keyId, environment: 'production', counter: 0 },
    });
  });

  it('refuses an attestation made for another challenge', async () => {
    setAppAttestRoot(pem(ca.rootCert));
    const session = await signUpAndRegister();
    await request(app).post(`/v1/devices/${session.deviceId}/attestation/challenge`).set(authed(session));
    const key = attestIphone(ca, 'not-the-challenge');
    const res = await request(app).post(`/v1/devices/${session.deviceId}/attestation`).set(authed(session)).send(key.attestation);
    expect(res.status).toBe(422);
    expect(res.body.error?.code ?? res.body.code).toBe('ATTESTATION_INVALID');
  });

  it('keeps a simulator’s key as unattested rather than refusing it', async () => {
    const session = await signUpAndRegister();
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { platform: 'ios' } });
    await request(app).post(`/v1/devices/${session.deviceId}/attestation/challenge`).set(authed(session));
    const { attestation } = attestIphone(ca, 'whatever');
    const res = await request(app).post(`/v1/devices/${session.deviceId}/attestation`).set(authed(session))
      .send({ ...attestation, attested: false, securityLevel: 'software', appAttest: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ attested: false });
    const device = await DeviceModel.findById(session.deviceId, { attestation: 1 }).lean();
    expect(device?.attestation).toMatchObject({ provider: 'app_attest', attested: false, failure: 'app_attest_unavailable' });
  });

  it('scores an iPhone’s day without Play Integrity or motion windows, and with Apple Health’s distance', async () => {
    // A server that asks Android phones for Play verdicts must not ask an iPhone.
    await AppConfigModel.updateOne(
      { _id: 'integrity' },
      { $set: { value: { playIntegrity: { cloudProjectNumber: 123456, freshHours: 6, maxTokenAgeMinutes: 10 } } } },
      { upsert: true },
    );
    invalidateConfig();
    try {
      const { session, key } = await attestedIphone();
      const nonce = (await request(app).post('/v1/activity/ingest/nonce').set(authed(session))).body.nonce;
      const date = localDayOf(new Date(), 'Asia/Kolkata');
      const payload = snapshotPayload({ date, nonce, deviceSteps: 4000 });
      // What react-native-step-tracker-pro-ios signs: no windows, ever.
      delete payload.motionWindows;
      Object.assign(payload, {
        platform: 'ios',
        libraryVersion: '1.1.0',
        motionWindowsStatus: 'unsupported',
        capabilities: { hasStepCounter: true, hasStepDetector: false, manufacturer: 'Apple', model: 'iPhone15,2', sdkInt: 0, osVersion: '26.1' },
      });
      const res = await request(app).post('/v1/activity/ingest')
        .set({ ...authed(session), 'idempotency-key': randomUUID() })
        .send({ date, snapshot: signSnapshot(key.signing, payload) });

      expect(res.status).toBe(200);
      expect(res.body.day).toMatchObject({ steps: 4000, verified: true });
      const flags = await FraudFlagModel.find({ userId: session.userId }, { kind: 1 }).lean();
      const kinds = flags.map(flag => flag.kind);
      expect(kinds).not.toContain('motion_absent');
      expect(kinds).not.toContain('play_integrity_missing');
      expect(kinds).not.toContain('boot_not_verified');
      const daily = await ActivityDailyModel.findById(`${session.userId}:${date}`).lean();
      expect(daily?.layers).toMatchObject({ L0: 100 });
    } finally {
      await AppConfigModel.deleteOne({ _id: 'integrity' });
      invalidateConfig();
    }
  });

  it('still penalises "unsupported" motion from a key App Attest never vouched for', async () => {
    const session = await signUpAndRegister();
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { platform: 'ios' } });
    await request(app).post(`/v1/devices/${session.deviceId}/attestation/challenge`).set(authed(session));
    const iphone = attestIphone(ca, 'whatever');
    await request(app).post(`/v1/devices/${session.deviceId}/attestation`).set(authed(session))
      .send({ ...iphone.attestation, attested: false, appAttest: null });
    const nonce = (await request(app).post('/v1/activity/ingest/nonce').set(authed(session))).body.nonce;
    const date = localDayOf(new Date(), 'Asia/Kolkata');
    const payload = snapshotPayload({ date, nonce, deviceSteps: 3000 });
    delete payload.motionWindows;
    Object.assign(payload, { platform: 'ios', motionWindowsStatus: 'unsupported' });
    const res = await request(app).post('/v1/activity/ingest')
      .set({ ...authed(session), 'idempotency-key': randomUUID() })
      .send({ date, snapshot: signSnapshot(iphone.signing, payload) });

    expect(res.status).toBe(200);
    const kinds = (await FraudFlagModel.find({ userId: session.userId }, { kind: 1 }).lean()).map(flag => flag.kind);
    expect(kinds).toContain('motion_absent');
    expect(kinds).toContain('key_not_attested');
  });
});

describe('admin: the fleet by platform (D-104)', () => {
  const ca = makeCa();
  const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

  it('counts iPhones apart from Android, and says why a key was kept unattested', async () => {
    expect((await request(app).get('/v1/admin/steps/phones')).status).toBe(401);

    const before = (await request(app).get('/v1/admin/steps/phones').set(ADMIN)).body;
    const iosBefore = before.platforms.find((row: { platform: string }) => row.platform === 'ios');

    // One iPhone that cannot attest (a simulator).
    const session = await signUpAndRegister();
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { platform: 'ios' } });
    await request(app).post(`/v1/devices/${session.deviceId}/attestation/challenge`).set(authed(session));
    const { attestation } = attestIphone(ca, 'whatever');
    await request(app).post(`/v1/devices/${session.deviceId}/attestation`).set(authed(session))
      .send({ ...attestation, attested: false, appAttest: null });

    const res = await request(app).get('/v1/admin/steps/phones').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.ios).toMatchObject({ bundleId: BUNDLE_ID, teamId: TEAM_ID, environments: ['production'] });
    const ios = res.body.platforms.find((row: { platform: string }) => row.platform === 'ios');
    expect(ios.installs).toBe(iosBefore.installs + 1);
    expect(ios.keyOnFile).toBe(iosBefore.keyOnFile + 1);
    expect(ios.attested).toBe(iosBefore.attested);
    expect(ios.failures).toEqual(expect.arrayContaining([expect.objectContaining({ failure: 'app_attest_unavailable' })]));
    expect(res.body.proofs).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: 'app_attest', verdict: 'unattested' })]),
    );

    // And the member's install page says what vouched for the key.
    const overview = await request(app).get(`/v1/admin/users/${session.userId}`).set(ADMIN);
    expect(overview.status).toBe(200);
    const install = overview.body.installs.find((row: { deviceId: string }) => row.deviceId === session.deviceId);
    expect(install.integrity.key).toMatchObject({ provider: 'app_attest', failure: 'app_attest_unavailable' });
    expect(install.integrity.play).toBeNull();
  });
});

