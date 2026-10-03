import { createHash, createPublicKey, X509Certificate } from 'node:crypto';
import { AsnConvert, type OctetString } from '@peculiar/asn1-schema';
import { Certificate } from '@peculiar/asn1-x509';
import {
  AttestationApplicationId,
  NonStandardKeyDescription,
  SecurityLevel,
  VerifiedBootState,
  id_ce_keyDescription,
} from '@peculiar/asn1-android';
import { spkiSha256 } from './googleRoots.js';

/**
 * Android key attestation, checked on the server where it cannot be patched
 * out (RULES A2, DV9): the key the app will sign step snapshots with was
 * generated in this phone's secure hardware, just now, for this app, on a
 * phone whose bootloader is locked and whose OS is the one its maker signed.
 *
 * Verified the way Google describes it: every certificate signed by the next,
 * the last one a Google root (by key — see `googleRoots.ts`), none revoked,
 * and the leaf's attestation extension (OID 1.3.6.1.4.1.11129.2.1.17)
 * carrying our challenge, our package and our signing certificate.
 */

/** What the app sends, as react-native-step-tracker-pro's `attestDevice()` reports it. */
export interface KeyAttestationInput {
  /** Hex SHA-256 of `publicKey`. */
  keyId: string;
  /** Base64 X.509 SubjectPublicKeyInfo. */
  publicKey: string;
  /** Base64 DER certificates, leaf first. */
  certificateChain: string[];
}

export interface KeyAttestationExpectations {
  /** The challenge the server issued for this key. */
  challenge: string;
  /** The package the attestation must name; null skips the check. */
  packageName: string | null;
  /** SHA-256 hex of the signing certificate(s); empty skips the check. */
  signingCertSha256: readonly string[];
  /** SPKI hashes a chain may end in — Google's roots, or a test's. */
  trustedRoots: ReadonlySet<string>;
  /** Revocation lookup by serial, or null when there is no list. */
  isRevoked: ((serialHex: string) => boolean) | null;
  now: Date;
}

/**
 * Why a key is not hardware-attested. The first two are refusals — the key
 * is not stored. The rest leave a usable key that simply proves less: a
 * phone that cannot attest still signs, and the fraud layers weigh it.
 */
export type AttestationFailure =
  | 'key_mismatch'
  | 'challenge_mismatch'
  | 'chain_invalid'
  | 'untrusted_root'
  | 'expired'
  | 'revoked'
  | 'no_extension'
  | 'wrong_package'
  | 'wrong_signer';

export type SecurityLevelName = 'strongbox' | 'tee' | 'software' | 'unknown';
export type BootStateName = 'verified' | 'self_signed' | 'unverified' | 'failed' | 'unknown';

export interface KeyAttestationResult {
  /** The key may be stored and trusted to sign. */
  acceptable: boolean;
  /** The hardware vouched for it: every check passed. */
  attested: boolean;
  failure: AttestationFailure | null;
  securityLevel: SecurityLevelName;
  verifiedBootState: BootStateName;
  deviceLocked: boolean | null;
  attestationVersion: number | null;
  packageNames: string[];
  signatureDigests: string[];
  /** Whether the chain was checked against a revocation list at all. */
  revocationChecked: boolean;
}

const SECURITY_LEVELS: Record<number, SecurityLevelName> = {
  [SecurityLevel.software]: 'software',
  [SecurityLevel.trustedEnvironment]: 'tee',
  [SecurityLevel.strongBox]: 'strongbox',
};

const BOOT_STATES: Record<number, BootStateName> = {
  [VerifiedBootState.verified]: 'verified',
  [VerifiedBootState.selfSigned]: 'self_signed',
  [VerifiedBootState.unverified]: 'unverified',
  [VerifiedBootState.failed]: 'failed',
};

/**
 * The bytes of an OCTET STRING as the ASN.1 library hands it back: a class
 * instance for some fields, a bare ArrayBuffer for those declared by
 * primitive type — `AttestationPackageInfo.packageName` among them.
 */
function bytes(value: OctetString | ArrayBuffer | ArrayBufferView): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from((value as OctetString).buffer);
}

function spkiDer(base64: string): Buffer {
  return createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' })
    .export({ type: 'spki', format: 'der' }) as Buffer;
}

interface ExtensionFacts {
  attestationVersion: number;
  securityLevel: SecurityLevelName;
  challenge: Buffer;
  verifiedBootState: BootStateName;
  deviceLocked: boolean | null;
  packageNames: string[];
  signatureDigests: string[];
}

/** The attestation extension of a leaf, or null when it has none. */
function readExtension(leaf: X509Certificate): ExtensionFacts | null {
  const cert = AsnConvert.parse(leaf.raw, Certificate);
  const extension = cert.tbsCertificate.extensions?.find(e => e.extnID === id_ce_keyDescription);
  if (!extension) return null;
  const description = AsnConvert.parse(bytes(extension.extnValue), NonStandardKeyDescription);

  // The root of trust is only ever hardware-enforced; the application id is
  // normally software-enforced, but a list is searched whichever it is in.
  const rootOfTrust = description.teeEnforced.findProperty('rootOfTrust');
  const applicationId =
    description.softwareEnforced.findProperty('attestationApplicationId') ??
    description.teeEnforced.findProperty('attestationApplicationId');

  let packageNames: string[] = [];
  let signatureDigests: string[] = [];
  if (applicationId) {
    const parsed = AsnConvert.parse(bytes(applicationId), AttestationApplicationId);
    packageNames = parsed.packageInfos.map(info => bytes(info.packageName).toString('utf8'));
    signatureDigests = parsed.signatureDigests.map(digest => bytes(digest).toString('hex'));
  }

  return {
    attestationVersion: Number(description.attestationVersion),
    securityLevel: SECURITY_LEVELS[description.attestationSecurityLevel] ?? 'unknown',
    challenge: bytes(description.attestationChallenge),
    verifiedBootState: rootOfTrust ? BOOT_STATES[rootOfTrust.verifiedBootState] ?? 'unknown' : 'unknown',
    deviceLocked: rootOfTrust ? Boolean(rootOfTrust.deviceLocked) : null,
    packageNames,
    signatureDigests,
  };
}

export function verifyKeyAttestation(
  input: KeyAttestationInput,
  expect: KeyAttestationExpectations,
): KeyAttestationResult {
  const result: KeyAttestationResult = {
    acceptable: false,
    attested: false,
    failure: null,
    securityLevel: 'unknown',
    verifiedBootState: 'unknown',
    deviceLocked: null,
    attestationVersion: null,
    packageNames: [],
    signatureDigests: [],
    revocationChecked: false,
  };
  const refuse = (failure: AttestationFailure) => ({ ...result, acceptable: false, attested: false, failure });
  const weak = (failure: AttestationFailure) => ({ ...result, acceptable: true, attested: false, failure });

  // The key itself first: the id must be its hash, and the leaf must be it.
  let publicKey: Buffer;
  try {
    publicKey = spkiDer(input.publicKey);
  } catch {
    return refuse('key_mismatch');
  }
  const keyId = createHash('sha256').update(Buffer.from(input.publicKey, 'base64')).digest('hex');
  if (keyId !== input.keyId.toLowerCase()) return refuse('key_mismatch');

  let chain: X509Certificate[];
  try {
    chain = input.certificateChain.map(der => new X509Certificate(Buffer.from(der, 'base64')));
  } catch {
    return weak('chain_invalid');
  }
  if (chain.length === 0) return weak('untrusted_root');
  const leafKey = chain[0].publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  if (!leafKey.equals(publicKey)) return refuse('key_mismatch');

  // Each certificate signed by the next, and the last by itself.
  for (let i = 0; i < chain.length; i += 1) {
    const issuer = chain[i + 1] ?? chain[i];
    let signed = false;
    try {
      signed = chain[i].verify(issuer.publicKey);
    } catch {
      signed = false;
    }
    if (!signed) return weak('chain_invalid');
  }

  // A device that refused attestation makes a self-signed key: usable, and
  // nothing more. So does an emulator's software keystore.
  const root = chain[chain.length - 1];
  if (!expect.trustedRoots.has(spkiSha256(root))) return weak('untrusted_root');

  let facts: ExtensionFacts | null;
  try {
    facts = readExtension(chain[0]);
  } catch {
    facts = null;
  }
  if (!facts) return weak('no_extension');
  Object.assign(result, {
    securityLevel: facts.securityLevel,
    verifiedBootState: facts.verifiedBootState,
    deviceLocked: facts.deviceLocked,
    attestationVersion: facts.attestationVersion,
    packageNames: facts.packageNames,
    signatureDigests: facts.signatureDigests,
  });

  // A genuine chain for someone else's challenge is a replay: refused.
  if (!facts.challenge.equals(Buffer.from(expect.challenge, 'utf8'))) return refuse('challenge_mismatch');

  // The root is a trust anchor and is never judged on its dates — an old
  // re-issue in a five-year-old phone has expired and is still Google's key.
  // The leaf's dates come from the phone's own clock, so they are not either.
  const now = expect.now.getTime();
  for (const cert of chain.slice(1, -1)) {
    if (new Date(cert.validFrom).getTime() > now || new Date(cert.validTo).getTime() < now) return weak('expired');
  }

  if (expect.isRevoked) {
    result.revocationChecked = true;
    if (chain.some(cert => expect.isRevoked!(cert.serialNumber))) return weak('revoked');
  }

  if (expect.packageName && !facts.packageNames.includes(expect.packageName)) return weak('wrong_package');
  if (
    expect.signingCertSha256.length > 0 &&
    !facts.signatureDigests.some(digest => expect.signingCertSha256.includes(digest.toLowerCase()))
  ) {
    return weak('wrong_signer');
  }

  return { ...result, acceptable: true, attested: true, failure: null };
}
