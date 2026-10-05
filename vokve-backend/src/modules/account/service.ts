import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { getConfig } from '../../config/remote.js';
import { toCoins } from '../../lib/coins.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import {
  accountDeletionSchema,
  accountSessionSchema,
  appAboutSchema,
  privacySettingsSchema,
  profileSummarySchema,
  supportFaqSchema,
  supportTicketSchema,
  type AccountDeletion,
  type AccountSession,
  type AppAbout,
  type PrivacySettings,
  type ProfileBadge,
  type ProfileGap,
  type ProfileSummary,
  type SupportCategory,
  type SupportFaq,
  type SupportTicket,
  type User,
} from '../../contracts/index.js';
import {
  ActivityDailyModel,
  ActivitySampleModel,
  DeviceDayModel,
  IngestNonceModel,
  MotionWindowModel,
  StepSnapshotModel,
  StepUploadModel,
} from '../activity/models.js';
import { AddressModel, OrderModel } from '../commerce/models.js';
import { CoinBalanceModel } from '../economy/models.js';
import { AppReleaseModel, DeviceModel } from '../devices/models.js';
import { listDevices, stopCounting } from '../devices/service.js';
import { NotificationPreferencesModel, RefreshTokenModel, UserModel, UserSettingsModel } from '../identity/models.js';
import { NotificationModel } from '../notifications/models.js';
import { AuditLogModel } from '../platform/models.js';
import { ReferralModel } from '../social/models.js';
import { StreakDayModel, StreakStateModel } from '../streak/models.js';
import { ChallengeCompletionModel, UserAchievementModel } from '../challenges/models.js';
import { LeaderboardResultModel, LeaderboardScoreModel } from '../leaderboard/models.js';
import { HydrationEntryModel, HydrationPlanModel } from '../hydration/models.js';
import { FoodEntryModel, FoodItemModel, NutritionProfileModel } from '../nutrition/models.js';
import { VitalReadingModel } from '../vitals/models.js';
import { streakFigures } from '../streak/service.js';
import { WorkoutModel } from '../training/models.js';
import { AccountPrivacyModel, MediaModel, SupportFaqModel, SupportTicketModel } from './models.js';
import { toUser } from '../identity/serialize.js';

// ─── Level and tiers (RULES P4) ────────────────────────────────────────────

/**
 * The rank name each level band carries. Five levels to a band, so the title
 * changes often enough to be worth chasing and rarely enough to mean
 * something; anything past the last band keeps the last title.
 */
const TIER_TITLES: readonly string[] = [
  'Athlo Rookie', // 1–4
  'Athlo Runner', // 5–9
  'Athlo Strider', // 10–14
  'Athlo Warrior', // 15–19
  'Athlo Champion', // 20–24
  'Athlo Legend', // 25+
];

/** `floor(sqrt(coins / 100))`, floored at 1 — a level nobody is ever below. */
export function levelFor(lifetimeCoins: number): number {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, lifetimeCoins) / 100)));
}

/** The coins the level's own band starts at — the inverse of `levelFor`. */
function coinsForLevel(level: number): number {
  return level * level * 100;
}

export function tierTitleFor(level: number): string {
  const band = Math.floor(level / 5);
  return TIER_TITLES[Math.min(band, TIER_TITLES.length - 1)]!;
}

const DAY_MS = 86_400_000;

// ─── Profile summary ───────────────────────────────────────────────────────

/** What each missing field is worth, and what to call it (RULES P6). */
const PROFILE_GAPS: readonly (ProfileGap & { done: (ctx: GapContext) => boolean })[] = [
  { field: 'name', label: 'Add your name', weight: 15, done: c => c.name.trim().length > 1 },
  { field: 'avatarUrl', label: 'Add a profile photo', weight: 10, done: c => Boolean(c.avatarUrl) },
  { field: 'dateOfBirth', label: 'Add your date of birth', weight: 10, done: c => Boolean(c.dateOfBirth) },
  { field: 'gender', label: 'Add your gender', weight: 5, done: c => Boolean(c.gender) },
  { field: 'heightCm', label: 'Add your height', weight: 15, done: c => Boolean(c.heightCm) },
  { field: 'weightKg', label: 'Add your weight', weight: 15, done: c => Boolean(c.weightKg) },
  { field: 'email', label: 'Verify your email', weight: 10, done: c => c.emailVerified },
  { field: 'phone', label: 'Verify your phone', weight: 10, done: c => c.phoneVerified },
  { field: 'address', label: 'Add a delivery address', weight: 10, done: c => c.hasAddress },
];

interface GapContext {
  name: string;
  avatarUrl: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  heightCm: number | null;
  weightKg: number | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  hasAddress: boolean;
}

interface BadgeSpec {
  id: string;
  label: string;
  description: string;
  icon: ProfileBadge['icon'];
  goal: number;
  value: number;
}

/** A spec becomes a badge: unlocked when the figure has reached the goal. */
function toBadge(spec: BadgeSpec, unlockedAt: string | null): ProfileBadge {
  const reached = spec.value >= spec.goal;
  return {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    icon: spec.icon,
    unlockedAt: reached ? unlockedAt : null,
    progress: Math.max(0, Math.min(1, spec.goal === 0 ? 1 : spec.value / spec.goal)),
    value: Math.min(spec.value, spec.goal),
    goal: spec.goal,
  };
}

/**
 * Everything the account screen says about a member, from the rows that
 * prove it (RULES P4, P6).
 *
 * One call rather than five: the screen paints all of it at once, and a
 * profile assembled from five separate fetches shows five different moments
 * in time on one card. The counts are cheap — indexed counts and one bounded
 * scan of the activity rollups — and nothing here is cached, so a coin
 * credited a second ago is on the profile a second later.
 */
export async function getProfileSummary(userId: string, timeZone: string): Promise<ProfileSummary> {
  const user = await UserModel.findById(userId).lean();
  if (!user || user.deletedAt) throw Errors.unauthorized();

  const balance = await CoinBalanceModel.findById(userId).lean();
  const lifetimeMc = balance?.lifetimeEarnedMc ?? 0;

  const [streak, activityTotals, workoutCount, workoutMinutes, orders, referrals, hasAddress, ahead, members] =
    await Promise.all([
      // The streak module's own figures, so this card and the streak screen agree.
      streakFigures(userId, timeZone),
      ActivityDailyModel.aggregate<{ steps: number; days: number }>([
        { $match: { userId } },
        { $group: { _id: null, steps: { $sum: '$steps' }, days: { $sum: { $cond: [{ $gt: ['$steps', 0] }, 1, 0] } } } },
      ]),
      WorkoutModel.countDocuments({ userId, deletedAt: null }),
      WorkoutModel.aggregate<{ minutes: number }>([
        { $match: { userId, deletedAt: null, completedAt: { $ne: null } } },
        { $group: { _id: null, minutes: { $sum: { $divide: [{ $subtract: ['$completedAt', '$startedAt'] }, 60_000] } } } },
      ]),
      OrderModel.countDocuments({ userId, status: { $ne: 'pending_payment' } }),
      ReferralModel.countDocuments({ inviterId: userId, status: 'rewarded' }),
      AddressModel.exists({ userId, deletedAt: null }),
      // Rank is "how many have earned more", which needs no leaderboard table.
      CoinBalanceModel.countDocuments({ lifetimeEarnedMc: { $gt: lifetimeMc } }),
      CoinBalanceModel.estimatedDocumentCount(),
    ]);

  const lifetimeCoins = toCoins(lifetimeMc);
  const coins = toCoins(balance?.balanceMc ?? 0);
  const level = levelFor(lifetimeCoins);
  const levelStart = coinsForLevel(level);
  const nextLevelAt = coinsForLevel(level + 1);
  const span = nextLevelAt - levelStart;

  const { current, longest } = streak;
  const totals = activityTotals[0] ?? { steps: 0, days: 0 };
  const minutes = Math.round(workoutMinutes[0]?.minutes ?? 0);

  const stats = {
    coins,
    lifetimeCoins,
    currentStreak: current,
    longestStreak: longest,
    totalSteps: Math.round(totals.steps ?? 0),
    activeDays: totals.days ?? 0,
    totalWorkouts: workoutCount,
    totalWorkoutMinutes: Math.max(0, minutes),
    orders,
    referrals,
  };

  const memberSince = (user.createdAt ?? new Date()).toISOString();
  const badges = [
    toBadge({ id: 'streak-7', label: 'Week One', description: 'A seven-day streak', icon: 'flame', goal: 7, value: longest }, memberSince),
    toBadge({ id: 'streak-30', label: 'Month Strong', description: 'A thirty-day streak', icon: 'flame', goal: 30, value: longest }, memberSince),
    toBadge({ id: 'steps-100k', label: 'Hundred K', description: '100,000 steps walked', icon: 'footprints', goal: 100_000, value: stats.totalSteps }, memberSince),
    toBadge({ id: 'workouts-25', label: 'Regular', description: '25 workouts finished', icon: 'dumbbell', goal: 25, value: workoutCount }, memberSince),
    toBadge({ id: 'coins-5000', label: 'Earner', description: '5,000 coins earned', icon: 'coins', goal: 5_000, value: lifetimeCoins }, memberSince),
    toBadge({ id: 'orders-1', label: 'First Order', description: 'Something bought with coins', icon: 'package', goal: 1, value: orders }, memberSince),
    toBadge({ id: 'referrals-3', label: 'Recruiter', description: 'Three friends brought along', icon: 'users', goal: 3, value: referrals }, memberSince),
  ];

  const context: GapContext = {
    name: user.name ?? '',
    avatarUrl: user.avatarUrl ?? null,
    dateOfBirth: user.dateOfBirth ?? null,
    gender: user.gender ?? null,
    heightCm: user.heightCm ?? null,
    weightKg: user.weightKg ?? null,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneVerified: Boolean(user.phoneVerifiedAt),
    hasAddress: Boolean(hasAddress),
  };
  const gaps = PROFILE_GAPS.filter(gap => !gap.done(context)).map(({ field, label, weight }) => ({ field, label, weight }));
  const completeness = 100 - gaps.reduce((sum, gap) => sum + gap.weight, 0);

  return profileSummarySchema.parse({
    level,
    tierTitle: tierTitleFor(level),
    xp: lifetimeCoins,
    xpIntoLevel: Math.max(0, lifetimeCoins - levelStart),
    xpForNextLevel: span,
    levelProgress: Math.max(0, Math.min(1, (lifetimeCoins - levelStart) / span)),
    memberSince,
    // Nobody is "rank 1 of 1" on their first day: a lone member is unranked.
    rank: members > 1 ? ahead + 1 : null,
    totalMembers: members,
    stats,
    badges,
    completeness: Math.max(0, Math.min(100, completeness)),
    gaps,
    trustTier: user.trust?.tier ?? 'normal',
  });
}

// ─── Avatar (RULES P10) ────────────────────────────────────────────────────

/** The image types a phone's picker actually produces, and nothing else. */
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AvatarType = (typeof AVATAR_TYPES)[number];

export const avatarBody = z.object({
  contentType: z.enum(AVATAR_TYPES),
  /** The image itself, base64, without a `data:` prefix. */
  data: z.string().min(1, 'Choose a photo').max(4_000_000),
}).strict();

/** The magic bytes each type starts with — a `.jpg` that is really a PDF is not an avatar. */
function sniff(buffer: Buffer): AvatarType | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** Where the app fetches a stored image from. Absolute: it goes into a `User`. */
export function mediaUrl(id: string): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/v1/media/avatars/${id}`;
}

/**
 * Stores a new profile photo and points the member's record at it.
 *
 * The bytes are sniffed rather than trusted: the declared type is a header
 * anyone can write, and an endpoint that serves whatever it was handed back
 * under an image content-type is one stored-XSS away from being a problem.
 * The previous avatar is deleted in the same breath — a member has one
 * photo, and keeping the old ones would mean keeping a face someone asked
 * us to replace.
 */
export async function setAvatar(
  userId: string,
  body: z.infer<typeof avatarBody>,
  meta: { deviceId?: string } = {},
): Promise<User> {
  const config = await getConfig();
  const user = await UserModel.findById(userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();

  const buffer = Buffer.from(body.data, 'base64');
  if (buffer.length === 0) throw Errors.validation({ data: 'That image could not be read.' });

  const maxBytes = config.account.avatarMaxKb * 1024;
  if (buffer.length > maxBytes) {
    throw new ApiError(413, 'AVATAR_TOO_LARGE', `Photos must be under ${config.account.avatarMaxKb} KB.`, { maxKb: config.account.avatarMaxKb, bytes: buffer.length });
  }
  const actual = sniff(buffer);
  if (!actual || actual !== body.contentType) {
    throw Errors.validation({ data: 'That file is not a JPEG, PNG or WebP image.' });
  }

  const id = newId('avt');
  await MediaModel.create({ _id: id, userId, kind: 'avatar', contentType: actual, bytes: buffer.length, data: buffer });
  // Only now is the old one unreachable: written first, swapped, then swept,
  // so a failure never leaves the record pointing at nothing.
  const previous = user.avatarUrl;
  user.avatarUrl = mediaUrl(id);
  await user.save();
  await MediaModel.deleteMany({ userId, kind: 'avatar', _id: { $ne: id } });

  await AuditLogModel.create({ actorType: 'user', actorId: userId, deviceId: meta.deviceId, action: 'user.avatar_set', subjectType: 'user', subjectId: userId, before: { avatarUrl: previous }, after: { avatarUrl: user.avatarUrl, bytes: buffer.length } });
  return toUser(user);
}

/** Drops the photo and goes back to initials. */
export async function removeAvatar(userId: string, meta: { deviceId?: string } = {}): Promise<User> {
  const user = await UserModel.findById(userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();
  await MediaModel.deleteMany({ userId, kind: 'avatar' });
  user.avatarUrl = null;
  await user.save();
  await AuditLogModel.create({ actorType: 'user', actorId: userId, deviceId: meta.deviceId, action: 'user.avatar_removed', subjectType: 'user', subjectId: userId });
  return toUser(user);
}

/** The bytes behind a media URL, or null. Served without a session (P10). */
/**
 * A stored binary as a Node Buffer.
 *
 * `lean()` hands back whatever the driver read — a Buffer on some paths, a
 * `Binary` wrapper holding its bytes under `.buffer` on others — and
 * `Buffer.from` of the wrapper yields an empty buffer rather than failing,
 * which is how a broken read becomes a 200 with no image in it.
 */
function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  const wrapped = (value as { buffer?: unknown })?.buffer;
  if (Buffer.isBuffer(wrapped)) return wrapped;
  if (wrapped instanceof Uint8Array) return Buffer.from(wrapped);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.alloc(0);
}

export async function getMedia(id: string): Promise<{ data: Buffer; contentType: string } | null> {
  const row = await MediaModel.findById(id).lean();
  if (!row) return null;
  return { data: toBuffer(row.data), contentType: row.contentType };
}

// ─── Privacy (RULES P7) ────────────────────────────────────────────────────

export const privacyBody = privacySettingsSchema.partial().strict();

export async function getPrivacy(userId: string): Promise<PrivacySettings> {
  const row = await AccountPrivacyModel.findOneAndUpdate(
    { _id: userId },
    { $setOnInsert: { _id: userId } },
    { upsert: true, new: true },
  ).lean();
  return privacySettingsSchema.parse({
    analytics: row?.analytics ?? true,
    personalisedOffers: row?.personalisedOffers ?? true,
    shareNameWithReferrer: row?.shareNameWithReferrer ?? true,
  });
}

export async function updatePrivacy(userId: string, patch: Partial<PrivacySettings>): Promise<PrivacySettings> {
  await AccountPrivacyModel.updateOne({ _id: userId }, { $set: patch }, { upsert: true });
  await AuditLogModel.create({ actorType: 'user', actorId: userId, action: 'user.privacy', subjectType: 'user', subjectId: userId, after: patch });
  return getPrivacy(userId);
}

/** Whether one switch is on, for the places that have to honour it. */
export async function privacyAllows(userId: string, key: keyof PrivacySettings): Promise<boolean> {
  const row = await AccountPrivacyModel.findById(userId).lean();
  return row ? row[key] !== false : true;
}

// ─── Password, email and phone ─────────────────────────────────────────────

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(72, 'That password is too long')
    .regex(/[a-zA-Z]/, 'Include a letter')
    .regex(/\d/, 'Include a number'),
}).strict();

/**
 * Changes the password and signs every other device out (RULES O10).
 *
 * The session that made the change survives — a member who just proved the
 * old password should not have to type the new one on the phone in their
 * hand — and every other refresh token is revoked, because "change my
 * password" is what someone does when they think another device has it.
 */
export async function changePassword(
  userId: string,
  body: z.infer<typeof changePasswordBody>,
  meta: { deviceId?: string },
): Promise<{ ok: boolean; signedOutSessions: number }> {
  const user = await UserModel.findById(userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();
  const matches = await bcrypt.compare(body.currentPassword, user.passwordHash);
  if (!matches) {
    throw new ApiError(422, 'PASSWORD_INCORRECT', 'That is not your current password.', { currentPassword: 'That is not your current password.' });
  }
  if (await bcrypt.compare(body.newPassword, user.passwordHash)) {
    throw new ApiError(422, 'PASSWORD_UNCHANGED', 'Choose a password you have not used here before.', { newPassword: 'Choose a different password.' });
  }
  user.passwordHash = await bcrypt.hash(body.newPassword, 12);
  await user.save();

  const revoked = await RefreshTokenModel.updateMany(
    { userId, revokedAt: null, ...(meta.deviceId ? { deviceId: { $ne: meta.deviceId } } : {}) },
    { $set: { revokedAt: new Date() } },
  );
  await AuditLogModel.create({ actorType: 'user', actorId: userId, deviceId: meta.deviceId, action: 'user.password_changed', subjectType: 'user', subjectId: userId, after: { revokedSessions: revoked.modifiedCount } });
  return { ok: true, signedOutSessions: revoked.modifiedCount };
}

// ─── Sessions ──────────────────────────────────────────────────────────────

export async function listSessions(userId: string, currentDeviceId?: string): Promise<AccountSession[]> {
  const devices = await listDevices(userId);
  return devices.map(device => accountSessionSchema.parse({ ...device, isCurrent: device.id === currentDeviceId }));
}

/**
 * Signs every other device out: their refresh tokens are revoked and their
 * device rows marked, so the next call from them is a 401 they cannot
 * refresh out of. The current device is left alone on purpose.
 */
export async function signOutOtherSessions(userId: string, currentDeviceId?: string): Promise<{ signedOut: number }> {
  const filter = { userId, revokedAt: null, ...(currentDeviceId ? { deviceId: { $ne: currentDeviceId } } : {}) };
  const revoked = await RefreshTokenModel.updateMany(filter, { $set: { revokedAt: new Date() } });
  await DeviceModel.updateMany(
    { userId, revokedAt: null, ...(currentDeviceId ? { _id: { $ne: currentDeviceId } } : {}) },
    { $set: { revokedAt: new Date(), 'push.token': null } },
  );
  await stopCounting(userId, currentDeviceId ? { except: currentDeviceId } : {});
  await AuditLogModel.create({ actorType: 'user', actorId: userId, deviceId: currentDeviceId, action: 'user.sessions_revoked', subjectType: 'user', subjectId: userId, after: { count: revoked.modifiedCount } });
  return { signedOut: revoked.modifiedCount };
}

// ─── Data export (RULES P8) ────────────────────────────────────────────────

/**
 * Everything the account holds, as one JSON document.
 *
 * Produced synchronously rather than queued: one member's data is a few
 * hundred rows, and a export that arrives while the screen is still open is
 * worth more than a mail that arrives tomorrow. The cooldown is what stops
 * it being used as a way to read the database in a loop.
 */
export async function exportAccount(userId: string): Promise<Record<string, unknown>> {
  const config = await getConfig();
  const user = await UserModel.findById(userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();

  const cooldownMs = config.account.exportCooldownHours * 3_600_000;
  if (user.lastExportAt && Date.now() - user.lastExportAt.getTime() < cooldownMs) {
    const retryAfterSeconds = Math.ceil((cooldownMs - (Date.now() - user.lastExportAt.getTime())) / 1000);
    throw new ApiError(429, 'EXPORT_TOO_SOON', 'Your last export was recent. Try again later.', { retryAfterSeconds });
  }

  const [settings, prefs, privacy, activity, workouts, streakDays, challenges, achievements, water, food, vitals, orders, addresses, referrals, notifications, tickets, devices] = await Promise.all([
    UserSettingsModel.findById(userId).lean(),
    NotificationPreferencesModel.findById(userId).lean(),
    getPrivacy(userId),
    ActivityDailyModel.find({ userId }).sort({ localDay: -1 }).lean(),
    WorkoutModel.find({ userId, deletedAt: null }).sort({ startedAt: -1 }).lean(),
    StreakDayModel.find({ userId }).sort({ localDay: -1 }).lean(),
    ChallengeCompletionModel.find({ userId }).sort({ completedAt: -1 }).lean(),
    UserAchievementModel.find({ userId }).sort({ achievedAt: -1 }).lean(),
    HydrationEntryModel.find({ userId, deletedAt: null }).sort({ at: -1 }).lean(),
    FoodEntryModel.find({ userId, deletedAt: null }).sort({ loggedAt: -1 }).lean(),
    VitalReadingModel.find({ userId, deletedAt: null }).sort({ recordedAt: -1 }).lean(),
    OrderModel.find({ userId }).sort({ placedAt: -1 }).lean(),
    AddressModel.find({ userId, deletedAt: null }).lean(),
    ReferralModel.find({ inviterId: userId }).lean(),
    NotificationModel.find({ userId }).sort({ createdAt: -1 }).limit(500).lean(),
    SupportTicketModel.find({ userId }).lean(),
    listDevices(userId),
  ]);

  user.lastExportAt = new Date();
  await user.save();
  await AuditLogModel.create({ actorType: 'user', actorId: userId, action: 'user.exported', subjectType: 'user', subjectId: userId });

  const strip = <T extends Record<string, unknown>>(rows: T[]) => rows.map(({ __v, userId: _u, ...rest }: Record<string, unknown>) => rest);

  return {
    exportedAt: new Date().toISOString(),
    format: 'vokve.account.v1',
    profile: {
      id: user._id, name: user.name, email: user.email, phone: user.phone, avatarUrl: user.avatarUrl,
      dateOfBirth: user.dateOfBirth, gender: user.gender, heightCm: user.heightCm, weightKg: user.weightKg,
      goal: user.goal, activityLevel: user.activityLevel, units: user.units, country: user.country, timezone: user.timezone,
      createdAt: user.createdAt, profileCompletedAt: user.profileCompletedAt,
      emailVerifiedAt: user.emailVerifiedAt, phoneVerifiedAt: user.phoneVerifiedAt,
    },
    settings: settings ? strip([settings])[0] : null,
    notificationPreferences: prefs ? strip([prefs])[0] : null,
    privacy,
    activity: strip(activity),
    workouts: strip(workouts),
    streakDays: strip(streakDays),
    challengeCompletions: strip(challenges),
    achievements: strip(achievements),
    hydration: strip(water),
    food: strip(food),
    vitals: strip(vitals),
    orders: strip(orders),
    addresses: strip(addresses),
    referrals: strip(referrals),
    notifications: strip(notifications),
    supportTickets: strip(tickets),
    devices,
  };
}

// ─── Deletion (RULES P5) ───────────────────────────────────────────────────

export const deleteAccountBody = z.object({
  password: z.string().min(1, 'Enter your password'),
  reason: z.string().trim().max(280).optional(),
}).strict();

interface DeletionFields {
  scheduledAt?: Date | null;
  purgeAt?: Date | null;
  reason?: string | null;
}

function toDeletion(user: { deletion?: DeletionFields | null }, graceDays: number): AccountDeletion {
  return accountDeletionSchema.parse({
    scheduledAt: user.deletion?.scheduledAt?.toISOString() ?? null,
    purgeAt: user.deletion?.purgeAt?.toISOString() ?? null,
    reason: user.deletion?.reason ?? null,
    graceDays,
  });
}

export async function getDeletion(userId: string): Promise<AccountDeletion> {
  const config = await getConfig();
  const user = await UserModel.findById(userId).lean();
  if (!user || user.deletedAt) throw Errors.unauthorized();
  return toDeletion(user, config.account.deletionGraceDays);
}

/**
 * Schedules a deletion the member can still call off (RULES P5). The
 * password is asked for again because this is the one action nothing else
 * can undo once the window closes, and a phone left on a table should not
 * be enough to end an account.
 */
export async function scheduleDeletion(
  userId: string,
  body: z.infer<typeof deleteAccountBody>,
  meta: { deviceId?: string },
): Promise<AccountDeletion> {
  const config = await getConfig();
  const user = await UserModel.findById(userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();
  if (user.flags?.legalHold) {
    throw Errors.forbidden('ACCOUNT_ON_HOLD', 'This account cannot be deleted right now. Contact support.');
  }
  const matches = await bcrypt.compare(body.password, user.passwordHash);
  if (!matches) throw new ApiError(422, 'PASSWORD_INCORRECT', 'That is not your password.', { password: 'That is not your password.' });

  const now = new Date();
  user.deletion = {
    scheduledAt: now,
    purgeAt: new Date(now.getTime() + config.account.deletionGraceDays * DAY_MS),
    reason: body.reason ?? null,
  };
  await user.save();
  await AuditLogModel.create({ actorType: 'user', actorId: userId, deviceId: meta.deviceId, action: 'user.deletion_scheduled', subjectType: 'user', subjectId: userId, after: { purgeAt: user.deletion.purgeAt, reason: body.reason ?? null } });
  return toDeletion(user, config.account.deletionGraceDays);
}

export async function cancelDeletion(userId: string, meta: { deviceId?: string }): Promise<AccountDeletion> {
  const config = await getConfig();
  const user = await UserModel.findById(userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();
  user.deletion = { scheduledAt: null, purgeAt: null, reason: null };
  await user.save();
  await AuditLogModel.create({ actorType: 'user', actorId: userId, deviceId: meta.deviceId, action: 'user.deletion_cancelled', subjectType: 'user', subjectId: userId });
  return toDeletion(user, config.account.deletionGraceDays);
}

/**
 * Carries out a scheduled deletion (RULES P5).
 *
 * The user row is anonymised rather than removed: the ledger and the orders
 * reference it, and accounting that cannot name the account it settled is
 * worse than a row that says only "Deleted member". Everything personal —
 * the contact details, the body measurements, the activity and workout
 * history, the addresses, the feed, the devices — goes.
 */
export async function purgeAccount(userId: string): Promise<void> {
  const user = await UserModel.findById(userId);
  if (!user || user.deletedAt) return;

  const stamp = Date.now().toString(36);
  user.set({
    name: 'Deleted member',
    email: `deleted+${userId}@vokve.invalid`,
    phone: `+000${stamp}${userId.slice(-6)}`,
    passwordHash: `deleted:${stamp}`,
    avatarUrl: null,
    heightCm: null,
    weightKg: null,
    dateOfBirth: null,
    gender: null,
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    deletedAt: new Date(),
    deletion: { scheduledAt: null, purgeAt: null, reason: null },
  });
  await user.save();

  await Promise.all([
    ActivityDailyModel.deleteMany({ userId }),
    // Health data goes with the account; the fraud flags and the audit log
    // stay — they hold counts and verdicts, and they are what stops the
    // same phone coming back as a fresh account.
    StepSnapshotModel.deleteMany({ userId }),
    StepUploadModel.deleteMany({ userId }),
    DeviceDayModel.deleteMany({ userId }),
    ActivitySampleModel.deleteMany({ userId }),
    MotionWindowModel.deleteMany({ userId }),
    IngestNonceModel.deleteMany({ userId }),
    WorkoutModel.deleteMany({ userId }),
    StreakDayModel.deleteMany({ userId }),
    StreakStateModel.deleteOne({ _id: userId }),
    ChallengeCompletionModel.deleteMany({ userId }),
    UserAchievementModel.deleteMany({ userId }),
    LeaderboardScoreModel.deleteMany({ userId }),
    LeaderboardResultModel.deleteMany({ userId }),
    HydrationEntryModel.deleteMany({ userId }),
    HydrationPlanModel.deleteOne({ _id: userId }),
    FoodEntryModel.deleteMany({ userId }),
    FoodItemModel.deleteMany({ ownerUserId: userId }),
    NutritionProfileModel.deleteOne({ _id: userId }),
    VitalReadingModel.deleteMany({ userId }),
    AddressModel.updateMany({ userId }, { $set: { deletedAt: new Date() } }),
    NotificationModel.deleteMany({ userId }),
    SupportTicketModel.deleteMany({ userId }),
    AccountPrivacyModel.deleteOne({ _id: userId }),
    MediaModel.deleteMany({ userId }),
    UserSettingsModel.deleteOne({ _id: userId }),
    NotificationPreferencesModel.deleteOne({ _id: userId }),
    RefreshTokenModel.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } }),
    DeviceModel.updateMany({ userId }, { $set: { revokedAt: new Date(), 'push.token': null } }),
    // Orders still on their way are stopped; the ledger keeps what was spent.
    OrderModel.updateMany({ userId, status: { $in: ['pending_payment', 'placed', 'confirmed'] } }, { $set: { status: 'cancelled' } }),
    ReferralModel.updateMany({ inviterId: userId, status: 'pending' }, { $set: { status: 'void' } }),
  ]);

  await AuditLogModel.create({ actorType: 'system', actorId: 'scheduler', action: 'user.purged', subjectType: 'user', subjectId: userId });
}

/** The daily sweep: every account whose grace window has closed. */
export async function purgeScheduledDeletions(now = new Date()): Promise<{ purged: number }> {
  const due = await UserModel.find({ deletedAt: null, 'deletion.purgeAt': { $lte: now } }, { _id: 1 }).lean();
  let purged = 0;
  for (const row of due) {
    try {
      await purgeAccount(row._id);
      purged += 1;
    } catch (err) {
      logger.error({ err, userId: row._id }, 'account.purge_failed');
    }
  }
  return { purged };
}

// ─── Support ───────────────────────────────────────────────────────────────

/** The words a search matches on; a typed "coin" finds "coins". */
function faqFilter(q: string | undefined, category: SupportCategory | undefined): Record<string, unknown> {
  const filter: Record<string, unknown> = { active: true };
  if (category) filter.category = category;
  const words = (q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length > 0) {
    filter.$and = words.map(word => {
      const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      return { $or: [{ question: re }, { answer: re }, { tags: re }] };
    });
  }
  return filter;
}

export async function listFaqs(q?: string, category?: SupportCategory): Promise<SupportFaq[]> {
  const rows = await SupportFaqModel.find(faqFilter(q, category)).sort({ sort: 1, _id: 1 }).limit(100).lean();
  return rows.map(row => supportFaqSchema.parse({ id: row._id, category: row.category, question: row.question, answer: row.answer }));
}

export const ticketBody = z.object({
  subject: z.string().trim().min(4, 'Say what it is about').max(120),
  category: z.enum(['account', 'coins', 'orders', 'tracking', 'payments', 'other']),
  message: z.string().trim().min(20, 'Tell us a little more — at least 20 characters').max(2000),
}).strict();

type TicketRow = {
  _id: string; reference: string; subject: string; category: string; status: string;
  messages: { id: string; from: string; body: string; createdAt: Date }[];
  createdAt: Date; updatedAt: Date;
};

function toTicket(row: TicketRow): SupportTicket {
  return supportTicketSchema.parse({
    id: row._id,
    reference: row.reference,
    subject: row.subject,
    category: row.category,
    status: row.status,
    messages: row.messages.map(m => ({ id: m.id, from: m.from, body: m.body, createdAt: m.createdAt.toISOString() })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Short, unambiguous when read aloud: no O/0 or I/1 to confuse. */
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newReference(): string {
  let out = '';
  for (let i = 0; i < 4; i += 1) out += REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)];
  return `VK-${out}`;
}

export async function listTickets(userId: string): Promise<SupportTicket[]> {
  const rows = await SupportTicketModel.find({ userId }).sort({ createdAt: -1 }).limit(50).lean();
  return rows.map(r => toTicket(r as unknown as TicketRow));
}

export async function getTicket(userId: string, id: string): Promise<SupportTicket> {
  const row = await SupportTicketModel.findOne({ _id: id, userId }).lean();
  if (!row) throw Errors.notFound('That ticket');
  return toTicket(row as unknown as TicketRow);
}

/**
 * Opens a ticket. The phone's own details ride along without being asked
 * for: the version and the model are the first two things support needs and
 * the last two a member wants to type.
 */
export async function createTicket(
  userId: string,
  body: z.infer<typeof ticketBody>,
  meta: { appVersion?: string; platform?: string; osVersion?: string; deviceId?: string },
): Promise<SupportTicket> {
  const now = new Date();
  const [row] = await SupportTicketModel.create([{
    _id: newId('tkt'),
    userId,
    reference: newReference(),
    subject: body.subject,
    category: body.category,
    status: 'open',
    messages: [{ id: newId('msg'), from: 'user', body: body.message, createdAt: now }],
    context: { appVersion: meta.appVersion, platform: meta.platform, osVersion: meta.osVersion, deviceId: meta.deviceId },
  }]);
  await AuditLogModel.create({ actorType: 'user', actorId: userId, deviceId: meta.deviceId, action: 'support.ticket_opened', subjectType: 'ticket', subjectId: row!._id });
  return toTicket(row!.toObject() as unknown as TicketRow);
}

export const replyBody = z.object({
  message: z.string().trim().min(2, 'Write a reply').max(2000),
}).strict();

/** Adds to a thread support has not closed. A closed one is opened by a new ticket. */
export async function replyToTicket(userId: string, id: string, message: string): Promise<SupportTicket> {
  const ticket = await SupportTicketModel.findOne({ _id: id, userId });
  if (!ticket) throw Errors.notFound('That ticket');
  if (ticket.status === 'closed') {
    throw Errors.conflict('TICKET_CLOSED', 'This ticket is closed. Open a new one and we will pick it up there.');
  }
  ticket.messages.push({ id: newId('msg'), from: 'user', body: message, createdAt: new Date() });
  if (ticket.status === 'resolved') ticket.status = 'open';
  await ticket.save();
  return toTicket(ticket.toObject() as unknown as TicketRow);
}

// ─── About ─────────────────────────────────────────────────────────────────

/** `1.2.10` sorts above `1.2.9` — compared part by part, not as text. */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(n => Number(n) || 0);
  const right = b.split('.').map(n => Number(n) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export async function getAbout(meta: { platform?: string; appVersion?: string; build?: string }): Promise<AppAbout> {
  const config = await getConfig();
  const platform = meta.platform === 'ios' ? 'ios' : 'android';
  const releases = await AppReleaseModel.find({ platform }).sort({ releasedAt: -1 }).limit(10).lean();
  const latest = releases.find(r => r.status === 'current') ?? releases[0] ?? null;
  const minVersion = config.app.minVersion[platform];
  const version = meta.appVersion ?? '0.0.0';

  return appAboutSchema.parse({
    name: 'VOKVE',
    company: config.support.company,
    version,
    build: meta.build ?? null,
    latestVersion: latest?.version ?? null,
    minVersion,
    updateRequired: compareVersions(version, minVersion) < 0,
    updateAvailable: latest ? compareVersions(version, latest.version) < 0 : false,
    storeUrl: config.app.storeUrl[platform],
    releaseNotes: releases.map(r => ({ version: r.version, releasedAt: r.releasedAt?.toISOString() ?? null, notes: r.notes ?? null })),
    links: config.support.links,
    supportEmail: config.support.email,
  });
}
