import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VerifiedBootState } from '@peculiar/asn1-android';
import { X509Certificate } from 'node:crypto';
import { verifyKeyAttestation, type KeyAttestationExpectations } from '../src/lib/attestation/keyAttestation.js';
import { GOOGLE_ROOT_KEYS } from '../src/lib/attestation/googleRoots.js';
import { DeviceModel } from '../src/modules/devices/models.js';
import { setTrustedAttestationRoots } from '../src/modules/integrity/service.js';
import { attestKey, makeCa, makeCertificate, SIGNING_DIGEST, type TestCa } from './attestation.js';
import { app, authed, signUpAndRegister } from './helpers.js';

let ca: TestCa;

beforeAll(() => {
  ca = makeCa();
});

afterEach(() => {
  setTrustedAttestationRoots(null);
});

const expectations = (overrides: Partial<KeyAttestationExpectations> = {}): KeyAttestationExpectations => ({
  challenge: 'challenge-1',
  packageName: 'com.vokve',
  signingCertSha256: [SIGNING_DIGEST.toString('hex')],
  trustedRoots: new Set([ca.rootSpkiSha256]),
  isRevoked: null,
  now: new Date(),
  ...overrides,
});

describe('key attestation (RULES A2, DV9)', () => {
  it('trusts the two published Google roots by their keys', () => {
    expect(GOOGLE_ROOT_KEYS.size).toBe(2);
  });

  it('accepts a genuine chain for our challenge, package and signer, and reads what it proves', () => {
    const key = attestKey(ca, { challenge: 'challenge-1' });
    const result = verifyKeyAttestation(key.attestation, expectations());
    expect(result).toMatchObject({
      acceptable: true, attested: true, failure: null, securityLevel: 'tee', verifiedBootState: 'verified',
      deviceLocked: true, attestationVersion: 200, packageNames: ['com.vokve'],
    });
  });

  it('refuses a genuine chain made for another challenge — a replay', () => {
    const key = attestKey(ca, { challenge: 'an-old-challenge' });
    expect(verifyKeyAttestation(key.attestation, expectations())).toMatchObject({ acceptable: false, failure: 'challenge_mismatch' });
  });

  it('refuses a key that is not the one described', () => {
    const key = attestKey(ca, { challenge: 'challenge-1' });
    const other = attestKey(ca, { challenge: 'challenge-1' });
    expect(verifyKeyAttestation({ ...key.attestation, keyId: other.attestation.keyId }, expectations()))
      .toMatchObject({ acceptable: false, failure: 'key_mismatch' });
    expect(verifyKeyAttestation({ ...key.attestation, certificateChain: other.attestation.certificateChain, }, expectations()))
      .toMatchObject({ acceptable: false, failure: 'key_mismatch' });
  });

  it('keeps a key whose chain proves nothing, as unattested', () => {
    const unattested = attestKey(ca, { challenge: 'challenge-1', selfSigned: true });
    expect(verifyKeyAttestation(unattested.attestation, expectations()))
      .toMatchObject({ acceptable: true, attested: false, failure: 'untrusted_root' });

    const genuine = attestKey(ca, { challenge: 'challenge-1' });
    expect(verifyKeyAttestation(genuine.attestation, expectations({ trustedRoots: GOOGLE_ROOT_KEYS })))
      .toMatchObject({ acceptable: true, attested: false, failure: 'untrusted_root' });
  });

  it('marks a forged link in the chain', () => {
    const key = attestKey(ca, { challenge: 'challenge-1' });
    const impostor = makeCa();
    const chain = [...key.attestation.certificateChain];
    chain[1] = impostor.intermediateCert.toString('base64');
    expect(verifyKeyAttestation({ ...key.attestation, certificateChain: chain }, expectations()))
      .toMatchObject({ acceptable: true, attested: false, failure: 'chain_invalid' });
  });

  it('marks a revoked certificate, a repackaged app and a foreign signer', () => {
    const key = attestKey(ca, { challenge: 'challenge-1' });
    const intermediateSerial = new X509Certificate(ca.intermediateCert).serialNumber;
    expect(verifyKeyAttestation(key.attestation, expectations({ isRevoked: serial => serial === intermediateSerial })))
      .toMatchObject({ attested: false, failure: 'revoked', revocationChecked: true });

    const repackaged = attestKey(ca, { challenge: 'challenge-1', packageName: 'com.vokve.mod' });
    expect(verifyKeyAttestation(repackaged.attestation, expectations())).toMatchObject({ attested: false, failure: 'wrong_package' });

    const resigned = attestKey(ca, { challenge: 'challenge-1', signingDigest: Buffer.alloc(32, 1) });
    expect(verifyKeyAttestation(resigned.attestation, expectations())).toMatchObject({ attested: false, failure: 'wrong_signer' });
  });

  it('reports an unlocked bootloader without refusing the key — the day scoring decides', () => {
    const key = attestKey(ca, { challenge: 'challenge-1', bootState: VerifiedBootState.unverified, deviceLocked: false });
    expect(verifyKeyAttestation(key.attestation, expectations()))
      .toMatchObject({ attested: true, verifiedBootState: 'unverified', deviceLocked: false });
  });

  it('judges an expired intermediate, but never the root or the leaf, by its dates', () => {
    const expiredCa = makeCa();
    expiredCa.intermediateCert = makeCertificate({
      subject: 'Test Attestation CA', issuer: 'Test Attestation Root', subjectKey: generateFrom(expiredCa),
      issuerKey: expiredCa.rootKey, serial: 2, notAfter: new Date(Date.now() - 60_000),
    });
    const key = attestKey(expiredCa, { challenge: 'challenge-1' });
    expect(verifyKeyAttestation(key.attestation, expectations({ trustedRoots: new Set([expiredCa.rootSpkiSha256]) })))
      .toMatchObject({ attested: false, failure: 'expired' });
  });
});

/** The intermediate's public key, so a re-issued intermediate still signs the same leaves. */
function generateFrom(testCa: TestCa) {
  return new X509Certificate(testCa.intermediateCert).publicKey;
}

describe('device attestation routes', () => {
  it('issues a challenge, accepts the key made for it once, and stores what it proved', async () => {
    setTrustedAttestationRoots(new Set([ca.rootSpkiSha256]));
    const session = await signUpAndRegister();

    const issued = await request(app).post(`/v1/devices/${session.deviceId}/attestation/challenge`).set(authed(session));
    expect(issued.status).toBe(200);
    expect(issued.body.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const key = attestKey(ca, { challenge: issued.body.challenge });
    const accepted = await request(app).post(`/v1/devices/${session.deviceId}/attestation`).set(authed(session)).send(key.attestation);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ keyId: key.attestation.keyId, attested: true, securityLevel: 'tee' });

    const device = await DeviceModel.findById(session.deviceId).lean();
    expect(device?.attestation).toMatchObject({ keyId: key.attestation.keyId, attested: true, verifiedBootState: 'verified', deviceLocked: true });

    // The challenge is spent.
    const again = await request(app).post(`/v1/devices/${session.deviceId}/attestation`).set(authed(session)).send(key.attestation);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ATTESTATION_CHALLENGE_INVALID');
  });

  it('refuses a chain made for another challenge, and keeps the key it had', async () => {
    setTrustedAttestationRoots(new Set([ca.rootSpkiSha256]));
    const session = await signUpAndRegister();
    await request(app).post(`/v1/devices/${session.deviceId}/attestation/challenge`).set(authed(session));

    const replay = attestKey(ca, { challenge: 'yesterdays-challenge' });
    const refused = await request(app).post(`/v1/devices/${session.deviceId}/attestation`).set(authed(session)).send(replay.attestation);
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({ code: 'ATTESTATION_INVALID', details: { failure: 'challenge_mismatch' } });
    expect((await DeviceModel.findById(session.deviceId).lean())?.attestation?.keyId).toBeUndefined();
  });

  it('stores a key that cannot be attested as unattested — such a phone still syncs', async () => {
    const session = await signUpAndRegister();
    const issued = await request(app).post(`/v1/devices/${session.deviceId}/attestation/challenge`).set(authed(session));
    const key = attestKey(ca, { challenge: issued.body.challenge, selfSigned: true });
    const accepted = await request(app).post(`/v1/devices/${session.deviceId}/attestation`).set(authed(session)).send(key.attestation);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ attested: false });
    expect((await DeviceModel.findById(session.deviceId).lean())?.attestation).toMatchObject({ attested: false, failure: 'untrusted_root' });
  });

  it('only lets a device attest itself', async () => {
    const session = await signUpAndRegister();
    const other = await signUpAndRegister();
    const res = await request(app).post(`/v1/devices/${other.deviceId}/attestation/challenge`).set(authed(session));
    expect(res.status).toBe(404);
  });
});
