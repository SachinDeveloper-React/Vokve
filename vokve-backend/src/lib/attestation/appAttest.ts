import { X509Certificate, createHash, type KeyObject } from 'node:crypto';

/**
 * Apple App Attest, the iOS counterpart of Android key attestation
 * (RULES A2, DV9), checked the way Apple's "Validating apps that connect to
 * your server" describes.
 *
 * react-native-step-tracker-pro-ios signs step snapshots with a Secure
 * Enclave key, exactly as Android signs with a Keystore key. What makes the
 * server trust that key is App Attest: the app attests an App Attest key
 * over `SHA256(challenge + "|" + keyId)`, so Apple's certificate for a
 * genuine install of *this* app carries this server's challenge and the
 * signing key's id. Verified here once, at attestation; every snapshot after
 * is the ordinary ECDSA check `ingest` already does.
 *
 * Ported from the package's reference verifier (`scripts/app-attest.mjs`),
 * node:crypto only.
 */

/** Apple App Attestation Root CA. SHA-256 fingerprint 1C:B9:82:3B:…:62:42:C9:32. */
export const APPLE_APP_ATTEST_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----
`;

export type AppAttestEnvironment = 'development' | 'production';

/** Why an App Attest attestation was refused. */
export type AppAttestFailure =
  | 'malformed'
  | 'chain_invalid'
  | 'nonce_mismatch'
  | 'key_mismatch'
  | 'wrong_app'
  | 'not_new'
  | 'wrong_environment'
  | 'challenge_mismatch';

export class AppAttestError extends Error {
  constructor(readonly failure: AppAttestFailure, message: string) {
    super(message);
    this.name = 'AppAttestError';
  }
}

export interface AppAttestInput {
  /** Base64 CBOR, from `DeviceAttestation.appAttest.attestationObject`. */
  attestationObject: string;
  /** App Attest's key id, base64. */
  keyId: string;
  /** `challenge|keyId` as the device attested it. */
  clientData: string;
  /** `DeviceAttestation.publicKey`: base64 SPKI of the Secure Enclave signing key. */
  signingPublicKey: string;
}

export interface AppAttestExpectations {
  challenge: string;
  teamId: string;
  bundleId: string;
  /** The environments whose aaguid is accepted. */
  environments: readonly AppAttestEnvironment[];
  /** Overridden by tests, which cannot get Apple to sign anything. */
  rootPem?: string;
  now?: Date;
}

export interface AppAttestResult {
  /** The App Attest credential key (PEM), for assertions later. */
  credentialPublicKey: string;
  /** Hex SHA-256 of the signing key: the id every snapshot names. */
  signingKeyId: string;
  environment: AppAttestEnvironment;
}

const sha256 = (...parts: (Buffer | Uint8Array | string)[]) =>
  createHash('sha256').update(Buffer.concat(parts.map(part => Buffer.from(part)))).digest();

/** OID 1.2.840.113635.100.8.2, DER: the extension carrying the nonce. */
const NONCE_OID = Buffer.from('06092a864886f763640802', 'hex');

const AAGUID: Record<AppAttestEnvironment, Buffer> = {
  development: Buffer.from('appattestdevelop', 'ascii'),
  production: Buffer.concat([Buffer.from('appattest', 'ascii'), Buffer.alloc(7)]),
};

type Cbor = number | boolean | null | string | Buffer | Cbor[] | { [key: string]: Cbor };

/** Just the CBOR App Attest uses: maps, arrays, strings, byte strings, ints. */
export function decodeCbor(input: Buffer): Cbor {
  const buf = input;
  let o = 0;
  const need = (n: number) => {
    if (o + n > buf.length) throw new Error('truncated CBOR');
  };
  const length = (ai: number): number => {
    if (ai < 24) return ai;
    if (ai === 24) { need(1); return buf[o++]; }
    if (ai === 25) { need(2); const v = buf.readUInt16BE(o); o += 2; return v; }
    if (ai === 26) { need(4); const v = buf.readUInt32BE(o); o += 4; return v; }
    if (ai === 27) { need(8); const v = Number(buf.readBigUInt64BE(o)); o += 8; return v; }
    throw new Error(`unsupported CBOR length ${ai}`);
  };
  const read = (depth: number): Cbor => {
    if (depth > 16) throw new Error('CBOR nested too deep');
    need(1);
    const ib = buf[o++];
    const major = ib >> 5;
    const ai = ib & 31;
    if (major === 7) {
      if (ai === 20) return false;
      if (ai === 21) return true;
      if (ai === 22) return null;
      throw new Error(`unsupported CBOR simple value ${ai}`);
    }
    const n = length(ai);
    switch (major) {
      case 0: return n;
      case 1: return -1 - n;
      case 2: { need(n); const v = Buffer.from(buf.subarray(o, o + n)); o += n; return v; }
      case 3: { need(n); const v = buf.toString('utf8', o, o + n); o += n; return v; }
      case 4: return Array.from({ length: n }, () => read(depth + 1));
      case 5: {
        const out: { [key: string]: Cbor } = {};
        for (let i = 0; i < n; i += 1) {
          const key = read(depth + 1);
          out[String(key)] = read(depth + 1);
        }
        return out;
      }
      default: throw new Error(`unsupported CBOR major type ${major}`);
    }
  };
  return read(0);
}

interface AuthData {
  rpIdHash: Buffer;
  counter: number;
  aaguid?: Buffer;
  credentialId?: Buffer;
}

/** rpIdHash | flags | counter | aaguid | credentialIdLength | credentialId … */
export function parseAuthData(authData: Buffer): AuthData {
  if (authData.length < 37) throw new Error('authenticator data too short');
  const out: AuthData = { rpIdHash: authData.subarray(0, 32), counter: authData.readUInt32BE(33) };
  if (authData.length >= 55) {
    out.aaguid = authData.subarray(37, 53);
    const idLength = authData.readUInt16BE(53);
    out.credentialId = authData.subarray(55, 55 + idLength);
  }
  return out;
}

/** The 32-byte nonce in the credential certificate's 1.2.840.113635.100.8.2 extension. */
function certificateNonce(certDer: Buffer): Buffer | null {
  const at = certDer.indexOf(NONCE_OID);
  if (at < 0) return null;
  // extnValue OCTET STRING { SEQUENCE { [1] { OCTET STRING (32) } } }
  const window = certDer.subarray(at + NONCE_OID.length, at + NONCE_OID.length + 48);
  const inner = window.indexOf(Buffer.from([0x04, 0x20]));
  return inner < 0 ? null : window.subarray(inner + 2, inner + 34);
}

/** The uncompressed P-256 point of an EC public key. */
function rawPoint(key: KeyObject): Buffer {
  const spki = key.export({ format: 'der', type: 'spki' });
  return spki.subarray(spki.length - 65);
}

const fail = (failure: AppAttestFailure, message: string): never => {
  throw new AppAttestError(failure, message);
};

/**
 * Verifies `DeviceAttestation.appAttest`. Throws `AppAttestError` naming the
 * check that failed; returns what to keep for the install.
 */
export function verifyAppAttestation(input: AppAttestInput, expect: AppAttestExpectations): AppAttestResult {
  const now = expect.now ?? new Date();
  let att: { fmt?: unknown; attStmt?: { x5c?: unknown; receipt?: unknown }; authData?: unknown };
  try {
    att = decodeCbor(Buffer.from(input.attestationObject, 'base64')) as typeof att;
  } catch (error) {
    return fail('malformed', `attestation object is not CBOR: ${(error as Error).message}`);
  }
  if (att?.fmt !== 'apple-appattest') fail('malformed', 'not an App Attest attestation');
  const x5c = att.attStmt?.x5c;
  const authData = att.authData;
  if (!Array.isArray(x5c) || x5c.length < 2 || !x5c.every(Buffer.isBuffer) || !Buffer.isBuffer(authData)) {
    return fail('malformed', 'attestation object is missing its certificates or authenticator data');
  }
  const [credDer, ...intermediates] = x5c as Buffer[];

  // 1. The certificates lead to Apple's App Attestation Root CA, each valid now.
  let chain: X509Certificate[];
  let root: X509Certificate;
  try {
    chain = [credDer, ...intermediates].map(der => new X509Certificate(der));
    root = new X509Certificate(expect.rootPem ?? APPLE_APP_ATTEST_ROOT_PEM);
  } catch {
    return fail('malformed', 'a certificate could not be read');
  }
  const path = [...chain, root];
  for (let i = 0; i < path.length - 1; i += 1) {
    const cert = path[i];
    const issuer = path[i + 1];
    if (!cert.checkIssued(issuer) || !cert.verify(issuer.publicKey)) fail('chain_invalid', `certificate ${i} is not issued by the next`);
    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) fail('chain_invalid', `certificate ${i} is not valid now`);
  }

  // 2. nonce = SHA256(authData || SHA256(clientData)) is in the credential certificate.
  const nonce = sha256(authData, sha256(Buffer.from(input.clientData, 'utf8')));
  const certNonce = certificateNonce(credDer);
  if (!certNonce || !certNonce.equals(nonce)) fail('nonce_mismatch', 'nonce does not match the credential certificate');

  // 3. SHA256 of the credential public key is the key id, and the credential id.
  const keyIdBytes = sha256(rawPoint(chain[0].publicKey));
  if (!keyIdBytes.equals(Buffer.from(input.keyId, 'base64'))) fail('key_mismatch', 'key id is not the credential key');
  let auth: AuthData;
  try {
    auth = parseAuthData(authData);
  } catch (error) {
    return fail('malformed', (error as Error).message);
  }
  if (!auth.credentialId?.equals(keyIdBytes)) fail('key_mismatch', 'credential id is not the key id');

  // 4. This app: rpIdHash = SHA256("<TeamID>.<bundleId>").
  if (!auth.rpIdHash.equals(sha256(`${expect.teamId}.${expect.bundleId}`))) fail('wrong_app', 'rpIdHash is not this app');

  // 5. A new key.
  if (auth.counter !== 0) fail('not_new', 'counter is not 0');

  // 6. An environment this server accepts.
  const environment = (Object.keys(AAGUID) as AppAttestEnvironment[]).find(env => auth.aaguid?.equals(AAGUID[env]));
  if (!environment || !expect.environments.includes(environment)) {
    fail('wrong_environment', `aaguid is not one of ${expect.environments.join(', ')}`);
  }

  // 7. The client data binds this server's challenge to the signing key.
  const signingKeyId = createHash('sha256').update(Buffer.from(input.signingPublicKey, 'base64')).digest('hex');
  if (input.clientData !== `${expect.challenge}|${signingKeyId}`) fail('challenge_mismatch', 'clientData is not challenge|keyId');

  return {
    credentialPublicKey: chain[0].publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    signingKeyId,
    environment: environment!,
  };
}
