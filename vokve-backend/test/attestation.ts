import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { AsnConvert, OctetString } from '@peculiar/asn1-schema';
import {
  AlgorithmIdentifier,
  AttributeTypeAndValue,
  AttributeValue,
  Certificate,
  Extension,
  Extensions,
  Name,
  RelativeDistinguishedName,
  SubjectPublicKeyInfo,
  TBSCertificate,
  Validity,
  Version,
} from '@peculiar/asn1-x509';
import {
  AttestationApplicationId,
  AttestationPackageInfo,
  AuthorizationList,
  KeyDescription,
  RootOfTrust,
  SecurityLevel,
  VerifiedBootState,
  id_ce_keyDescription,
} from '@peculiar/asn1-android';

/**
 * Android key attestation, made in a test: a root and an intermediate that
 * stand in for Google's, and a leaf carrying the attestation extension a
 * phone's Keystore would — challenge, package, signing certificate, boot
 * state — over a fresh P-256 key the "phone" then signs snapshots with.
 */

const ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const DAY_MS = 86_400_000;

function name(commonName: string): Name {
  return new Name([
    new RelativeDistinguishedName([
      new AttributeTypeAndValue({ type: '2.5.4.3', value: new AttributeValue({ utf8String: commonName }) }),
    ]),
  ]);
}

const arrayBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

interface CertSpec {
  subject: string;
  issuer: string;
  subjectKey: KeyObject;
  issuerKey: KeyObject;
  serial: number;
  extensions?: Extension[];
  notAfter?: Date;
}

export function makeCertificate(spec: CertSpec): Buffer {
  const tbs = new TBSCertificate({
    version: Version.v3,
    serialNumber: arrayBuffer(new Uint8Array([0x01, spec.serial & 0xff])),
    signature: new AlgorithmIdentifier({ algorithm: ECDSA_SHA256 }),
    issuer: name(spec.issuer),
    validity: new Validity({ notBefore: new Date(Date.now() - DAY_MS), notAfter: spec.notAfter ?? new Date(Date.now() + 365 * DAY_MS) }),
    subject: name(spec.subject),
    subjectPublicKeyInfo: AsnConvert.parse(spec.subjectKey.export({ type: 'spki', format: 'der' }), SubjectPublicKeyInfo),
    extensions: spec.extensions ? new Extensions(spec.extensions) : undefined,
  });
  const signature = sign('sha256', Buffer.from(AsnConvert.serialize(tbs)), { key: spec.issuerKey, dsaEncoding: 'der' });
  const certificate = new Certificate({
    tbsCertificate: tbs,
    signatureAlgorithm: new AlgorithmIdentifier({ algorithm: ECDSA_SHA256 }),
    signatureValue: arrayBuffer(signature),
  });
  return Buffer.from(AsnConvert.serialize(certificate));
}

export interface TestCa {
  rootKey: KeyObject;
  rootCert: Buffer;
  intermediateKey: KeyObject;
  intermediateCert: Buffer;
  /** What `verifyKeyAttestation` trusts this root by. */
  rootSpkiSha256: string;
}

export function makeCa(): TestCa {
  const root = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const intermediate = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const rootCert = makeCertificate({ subject: 'Test Attestation Root', issuer: 'Test Attestation Root', subjectKey: root.publicKey, issuerKey: root.privateKey, serial: 1 });
  const intermediateCert = makeCertificate({ subject: 'Test Attestation CA', issuer: 'Test Attestation Root', subjectKey: intermediate.publicKey, issuerKey: root.privateKey, serial: 2 });
  return {
    rootKey: root.privateKey,
    rootCert,
    intermediateKey: intermediate.privateKey,
    intermediateCert,
    rootSpkiSha256: createHash('sha256').update(root.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
  };
}

export interface KeyOptions {
  challenge: string;
  packageName?: string;
  signingDigest?: Buffer;
  bootState?: VerifiedBootState;
  deviceLocked?: boolean;
  /** No attestation extension at all, as a phone that refused attestation would make. */
  selfSigned?: boolean;
}

export interface TestKey {
  privateKey: KeyObject;
  /** What `attestDevice()` hands the app, and the app posts. */
  attestation: {
    keyId: string;
    algorithm: string;
    publicKey: string;
    certificateChain: string[];
    attested: boolean;
    securityLevel: string;
    createdAt: number;
  };
}

export const SIGNING_DIGEST = createHash('sha256').update('vokve release certificate').digest();

export function attestKey(ca: TestCa, options: KeyOptions): TestKey {
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = key.publicKey.export({ type: 'spki', format: 'der' });

  let chain: Buffer[];
  if (options.selfSigned) {
    chain = [makeCertificate({ subject: 'Android Keystore Key', issuer: 'Android Keystore Key', subjectKey: key.publicKey, issuerKey: key.privateKey, serial: 9 })];
  } else {
    const applicationId = new AttestationApplicationId({
      packageInfos: [new AttestationPackageInfo({ packageName: new OctetString(Buffer.from(options.packageName ?? 'com.vokve')), version: 1 })],
      signatureDigests: [new OctetString(options.signingDigest ?? SIGNING_DIGEST)],
    });
    const description = new KeyDescription({
      attestationVersion: 200,
      attestationSecurityLevel: SecurityLevel.trustedEnvironment,
      keymasterVersion: 200,
      keymasterSecurityLevel: SecurityLevel.trustedEnvironment,
      attestationChallenge: new OctetString(Buffer.from(options.challenge, 'utf8')),
      uniqueId: new OctetString(new Uint8Array(0)),
      softwareEnforced: new AuthorizationList({
        attestationApplicationId: new OctetString(AsnConvert.serialize(applicationId)),
      }),
      teeEnforced: new AuthorizationList({
        rootOfTrust: new RootOfTrust({
          verifiedBootKey: new OctetString(new Uint8Array(32).fill(7)),
          deviceLocked: options.deviceLocked ?? true,
          verifiedBootState: options.bootState ?? VerifiedBootState.verified,
          verifiedBootHash: new OctetString(new Uint8Array(32).fill(9)),
        }),
      }),
    });
    const leaf = makeCertificate({
      subject: 'Android Keystore Key',
      issuer: 'Test Attestation CA',
      subjectKey: key.publicKey,
      issuerKey: ca.intermediateKey,
      serial: 3,
      extensions: [new Extension({ extnID: id_ce_keyDescription, critical: false, extnValue: new OctetString(AsnConvert.serialize(description)) })],
    });
    chain = [leaf, ca.intermediateCert, ca.rootCert];
  }

  return {
    privateKey: key.privateKey,
    attestation: {
      keyId: createHash('sha256').update(spki).digest('hex'),
      algorithm: 'SHA256withECDSA',
      publicKey: spki.toString('base64'),
      certificateChain: chain.map(cert => cert.toString('base64')),
      attested: !options.selfSigned,
      securityLevel: 'tee',
      createdAt: Date.now(),
    },
  };
}

/** A snapshot signed the way the phone signs one: the exact JSON text, SHA256withECDSA, DER, base64. */
export function signSnapshot(key: TestKey, payload: Record<string, unknown>) {
  const signedPayload = JSON.stringify(payload);
  return {
    keyId: key.attestation.keyId,
    algorithm: 'SHA256withECDSA',
    value: sign('sha256', Buffer.from(signedPayload, 'utf8'), { key: key.privateKey, dsaEncoding: 'der' }).toString('base64'),
    attested: key.attestation.attested,
    signedPayload,
    payloadSha256: createHash('sha256').update(signedPayload, 'utf8').digest('hex'),
  };
}

export interface DayShape {
  date: string;
  nonce: string;
  deviceSteps: number;
  recoveredSteps?: number;
  suspectSteps?: number;
  resolvedSteps?: number;
  /** The other app the phone showed `resolvedSteps` from; its own count when absent. */
  resolvedBy?: { packageName: string; appName: string; kind?: string };
  timezone?: string;
  signedAt?: number;
  /** Minutes of walking, spread from `walkStartHour` (09:00) local in steps of `perMinute`. */
  walkingMinutes?: number;
  /** The local hour the walk starts at; 9 when absent. */
  walkStartHour?: number;
  perMinute?: number;
  windows?: { hz: number; variance: number; steps: number }[];
  sources?: Record<string, unknown>[];
  records?: Record<string, unknown>[];
  emulator?: boolean;
}

/** A `VerificationSnapshot` as react-native-step-tracker-pro 2.4 builds one, with the parts a test varies. */
export function snapshotPayload(shape: DayShape): Record<string, unknown> {
  const timezone = shape.timezone ?? 'Asia/Kolkata';
  // The walk's start, 09:00 IST unless the shape says, in epoch ms.
  const start =Date.parse(`${shape.date}T${String(shape.walkStartHour ?? 9).padStart(2, '0')}:00:00+05:30`);
  const perMinute = shape.perMinute ?? 100;
  const minutes = Array.from({ length: shape.walkingMinutes ?? Math.round(shape.deviceSteps / perMinute) }, (_, i) => ({
    minuteStart: start + i * 60_000, steps: perMinute, untimedSteps: 0, chargingSteps: 0, stillSteps: 0, vehicleSteps: 0,
  }));
  const windows = (shape.windows ?? [{ hz: 1.9, variance: 4, steps: 180 }, { hz: 1.8, variance: 3.5, steps: 170 }]).map((w, i) => ({
    startedAt: start + i * 300_000, durationMs: 10_000, sampleCount: 500, dominantFrequencyHz: w.hz, variance: w.variance,
    zeroCrossingRate: w.hz * 2, peakRatio: 0.5, stepsDuringWindow: w.steps,
  }));
  return {
    schemaVersion: 2,
    libraryVersion: '2.4.0',
    date: shape.date,
    deviceSteps: shape.deviceSteps,
    recoveredSteps: shape.recoveredSteps ?? 0,
    sensor: 'step_counter',
    coverageStartAt: 0,
    sources: shape.sources ?? [],
    sourcesStatus: shape.sources ? 'read' : 'not_consulted',
    resolved: {
      date: shape.date, steps: shape.resolvedSteps ?? shape.deviceSteps, kind: shape.resolvedBy?.kind ?? 'self',
      packageName: shape.resolvedBy?.packageName ?? null, appName: shape.resolvedBy?.appName ?? 'This device',
      deviceSteps: shape.deviceSteps, externalSteps: shape.resolvedBy ? shape.resolvedSteps ?? 0 : 0, usedExternal: !!shape.resolvedBy,
      merged: false, baselineSteps: 0, manualStepsExcluded: 0, suspectStepsExcluded: 0, distanceSource: 'derived',
    },
    capabilities: { hasStepCounter: true, hasStepDetector: true, manufacturer: 'Google', model: 'Pixel 8', sdkInt: 35 },
    health: { recoveryCount: 0, lastRecoveryReason: null, batteryOptimizationEnabled: false, aggressiveOem: false },
    clock: { wallClockMs: shape.signedAt ?? Date.now(), bootId: Date.now() - 3_600_000, timezone, utcOffsetMinutes: 330 },
    suspectSteps: shape.suspectSteps ?? 0,
    integrity: {
      date: shape.date, enabled: true, mode: 'flag', deviceSteps: shape.deviceSteps, suspectSteps: shape.suspectSteps ?? 0,
      flags: shape.suspectSteps ? [{ type: 'cadence', severity: 'strong', from: start, to: start + 60_000, steps: shape.suspectSteps, evidence: {} }] : [],
      events: [], minutes: {}, evaluatedAt: Date.now(), rules: {}, charging: false,
      activityRecognition: { requested: false, available: false, current: 'unknown' },
      device: { emulator: shape.emulator ?? false, testKeysBuild: false, suBinary: false, adbEnabled: false, developerOptions: false, appDebuggable: false, stepCounter: null },
    },
    include: ['minutes', 'motionWindows', ...(shape.records ? ['healthConnectRecords'] : [])],
    minutesStatus: 'enabled',
    minutes,
    motionWindowsStatus: 'enabled',
    motionWindows: windows,
    ...(shape.records ? { healthConnectRecords: { status: 'read', recordTypes: ['steps'], records: shape.records, truncated: false } } : {}),
    nonce: shape.nonce,
    signedAt: shape.signedAt ?? Date.now(),
  };
}
