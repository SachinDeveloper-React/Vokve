import { getConfig } from '../../config/remote.js';
import { env } from '../../config/env.js';
import { DeviceModel } from '../devices/models.js';
import { AttestationRecordModel } from '../integrity/models.js';

/**
 * The fleet by platform, and what vouches for each phone's key (D-104).
 *
 * iPhones count through react-native-step-tracker-pro-ios and prove their
 * Secure Enclave key with Apple's App Attest; Android phones prove a
 * Keystore key with Google's key attestation and, now and then, a Play
 * Integrity verdict. The two paths fail for different reasons, and the one
 * question an operator asks the day iPhones go live is "are they attesting,
 * and if not, why" — which is a count by failure, not a member page at a
 * time.
 *
 * Also what the server expects of an iPhone's attestation (`integrity.ios`),
 * so a team id that is wrong — every iPhone refused — or missing — every
 * iPhone unattested — is visible next to the numbers it explains.
 */

const DAY_MS = 86_400_000;

export type Platform = 'android' | 'ios';

export interface PlatformRow {
  platform: Platform;
  /** Installs not revoked. */
  installs: number;
  /** Of those, signed in right now (an open counting period). */
  signedIn: number;
  /** With a signing key on file — what every snapshot is checked against. */
  keyOnFile: number;
  /** Of those, vouched for by Google (Android) or Apple (iOS). */
  attested: number;
  /** Accepted a snapshot in the last 30 days. */
  syncing: number;
  /** Why keys were kept unattested, most common first. */
  failures: { failure: string; installs: number }[];
}

export interface PhonesView {
  platforms: PlatformRow[];
  /** Every proof recorded in the last 30 days, by provider and verdict. */
  proofs: { provider: string; verdict: string; count: number }[];
  ios: {
    bundleId: string;
    teamId: string | null;
    /** Where the team id in force comes from: `APPLE_TEAM_ID` beats config. */
    teamIdFrom: 'env' | 'config' | null;
    /** Aaguids accepted, as configured. */
    environments: string[];
    /** Outside production the development environment is accepted as well. */
    acceptsDevelopment: boolean;
  };
  windowDays: number;
}

const WINDOW_DAYS = 30;

export async function phonesView(now = new Date()): Promise<PhonesView> {
  const config = await getConfig();
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);

  const [byPlatform, failures, proofs] = await Promise.all([
    DeviceModel.aggregate<{ _id: string; installs: number; signedIn: number; keyOnFile: number; attested: number; syncing: number }>([
      { $match: { revokedAt: null } },
      {
        $group: {
          _id: '$platform',
          installs: { $sum: 1 },
          signedIn: {
            $sum: {
              $cond: [
                { $gt: [{ $size: { $filter: { input: { $ifNull: ['$counting', []] }, cond: { $eq: ['$$this.to', null] } } } }, 0] },
                1,
                0,
              ],
            },
          },
          keyOnFile: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$attestation.keyId', null] }, null] }, 1, 0] } },
          attested: { $sum: { $cond: [{ $eq: ['$attestation.attested', true] }, 1, 0] } },
          syncing: { $sum: { $cond: [{ $gte: ['$stepSync.uploadedAt', since] }, 1, 0] } },
        },
      },
    ]),
    DeviceModel.aggregate<{ _id: { platform: string; failure: string }; installs: number }>([
      { $match: { revokedAt: null, 'attestation.keyId': { $type: 'string' }, 'attestation.attested': { $ne: true } } },
      { $group: { _id: { platform: '$platform', failure: { $ifNull: ['$attestation.failure', 'unknown'] } }, installs: { $sum: 1 } } },
      { $sort: { installs: -1 } },
    ]),
    AttestationRecordModel.aggregate<{ _id: { provider: string; verdict: string }; count: number }>([
      { $match: { checkedAt: { $gte: since } } },
      { $group: { _id: { provider: '$provider', verdict: '$verdict' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  const platforms = (['android', 'ios'] as const).map((platform): PlatformRow => {
    const row = byPlatform.find(entry => entry._id === platform);
    return {
      platform,
      installs: row?.installs ?? 0,
      signedIn: row?.signedIn ?? 0,
      keyOnFile: row?.keyOnFile ?? 0,
      attested: row?.attested ?? 0,
      syncing: row?.syncing ?? 0,
      failures: failures
        .filter(entry => entry._id.platform === platform)
        .map(entry => ({ failure: entry._id.failure, installs: entry.installs })),
    };
  });

  const ios = config.integrity.ios;
  const teamId = env.APPLE_TEAM_ID ?? ios.teamId ?? null;
  return {
    platforms,
    proofs: proofs.map(entry => ({ provider: entry._id.provider, verdict: entry._id.verdict, count: entry.count })),
    ios: {
      bundleId: ios.bundleId,
      teamId,
      teamIdFrom: env.APPLE_TEAM_ID ? 'env' : ios.teamId ? 'config' : null,
      environments: [...ios.environments],
      acceptsDevelopment: env.NODE_ENV !== 'production' || ios.environments.includes('development'),
    },
    windowDays: WINDOW_DAYS,
  };
}
