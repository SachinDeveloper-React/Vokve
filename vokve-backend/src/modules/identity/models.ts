import { Schema, model } from 'mongoose';

const userSchema = new Schema(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true },
    /**
     * Optional since Google sign-in (RULES O12): Google proves an email and
     * knows nothing about a phone. An account can exist without one and
     * sign in — it is two *verified* contacts that spending needs (O5),
     * which `phoneVerifiedAt` already answers for.
     */
    phone: { type: String, default: undefined },
    passwordHash: { type: String, required: true },
    name: { type: String, default: '' },
    avatarUrl: { type: String, default: null },
    heightCm: { type: Number, default: null },
    weightKg: { type: Number, default: null },
    dateOfBirth: { type: String, default: null },
    gender: { type: String, enum: ['male', 'female', 'other', null], default: null },
    goal: { type: String, default: 'stay_active' },
    activityLevel: { type: String, default: 'moderate' },
    units: { type: String, enum: ['metric', 'imperial'], default: 'metric' },
    weeklyGoalWorkouts: { type: Number, default: 4 },
    streakDays: { type: Number, default: 0 },
    country: { type: String, default: 'IN' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    phoneVerifiedAt: { type: Date, default: null },
    emailVerifiedAt: { type: Date, default: null },
    /**
     * Google's stable id for this account (the token's `sub`), where the
     * member has signed in with Google. Matched on in preference to the
     * email: an address can be changed, given up and reissued, and `sub`
     * cannot.
     */
    googleId: { type: String, default: undefined },
    profileCompletedAt: { type: Date, default: null },
    trust: { score: { type: Number, default: 60 }, tier: { type: String, default: 'normal' }, updatedAt: Date },
    flags: { frozen: { type: Boolean, default: false }, legalHold: { type: Boolean, default: false } },
    /**
     * A deletion the member asked for and can still call off (RULES P5).
     * `purgeAt` is when the daily job actually anonymises the row; both are
     * cleared when the deletion is cancelled.
     */
    deletion: {
      scheduledAt: { type: Date, default: null },
      purgeAt: { type: Date, default: null },
      reason: { type: String, default: null },
    },
    /** When the last data export was produced, for the cooldown between them. */
    lastExportAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'users' },
);
userSchema.index({ email: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
// Sparse, because an account that arrived through Google has no phone at
// all: a plain unique index treats every one of them as the same missing
// value and refuses the second. A phone that *is* there is still unique.
userSchema.index({ phone: 1 }, { unique: true, sparse: true });
// `default: undefined` above and sparse here are one decision: a sparse
// index skips a *missing* field and happily indexes `null`, so a default
// of null would put every password account in this unique index under the
// same value and the second sign-up would collide.
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });
userSchema.index({ country: 1 });
userSchema.index({ 'trust.tier': 1 });
userSchema.index({ 'deletion.purgeAt': 1 }, { sparse: true });
export const UserModel = model('User', userSchema);
export type UserDoc = InstanceType<typeof UserModel>;

const refreshTokenSchema = new Schema(
  {
    userId: { type: String, required: true },
    deviceId: { type: String, default: null },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    supersededBy: { type: String, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'refresh_tokens' },
);
refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ userId: 1, deviceId: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RefreshTokenModel = model('RefreshToken', refreshTokenSchema);

/**
 * One collection for every code the product sends (RULES O2): channel says
 * where it went, purpose says what passing it unlocks, and a code can only
 * ever complete its own challenge.
 */
export const OTP_PURPOSES = ['signup', 'verify_email', 'verify_phone', 'login', 'reset_password', 'change_phone', 'change_email', 'step_up'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

const otpChallengeSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, default: null },
    channel: { type: String, enum: ['sms', 'email'], required: true },
    purpose: { type: String, enum: OTP_PURPOSES, required: true },
    target: { type: String, required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    resends: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    resendAfter: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    payload: { type: Schema.Types.Mixed, default: null },
    /** Never delivered; exists so unknown identifiers get the same shape (RULES O9). */
    decoy: { type: Boolean, default: false },
    deviceId: String,
    ip: String,
  },
  { timestamps: true, collection: 'otp_challenges' },
);
otpChallengeSchema.index({ target: 1, purpose: 1, createdAt: -1 });
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
export const OtpChallengeModel = model('OtpChallenge', otpChallengeSchema);

const userSettingsSchema = new Schema(
  {
    _id: { type: String, required: true },
    units: { type: String, default: 'metric' },
    dailyStepGoal: { type: Number, default: 10000 },
    /** When the member last chose their step goal; null while it is the one every account starts on (D-55). */
    stepGoalSetAt: { type: Date, default: null },
    dailyWaterGoalMl: { type: Number, default: 2500 },
    restTimerSeconds: { type: Number, default: 90 },
    hapticsEnabled: { type: Boolean, default: true },
    workoutRemindersEnabled: { type: Boolean, default: true },
    keepAwakeDuringWorkout: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'user_settings' },
);
export const UserSettingsModel = model('UserSettings', userSettingsSchema);

const notificationPreferencesSchema = new Schema(
  {
    _id: { type: String, required: true },
    categories: {
      activity: { type: Boolean, default: true }, coins: { type: Boolean, default: true },
      challenges: { type: Boolean, default: true }, orders: { type: Boolean, default: true },
      offers: { type: Boolean, default: true }, announcements: { type: Boolean, default: true },
      referrals: { type: Boolean, default: true }, health: { type: Boolean, default: false },
    },
    quietHours: { enabled: { type: Boolean, default: true }, start: { type: String, default: '22:00' }, end: { type: String, default: '07:00' } },
    sms: { type: Boolean, default: true },
    email: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'notification_preferences' },
);
export const NotificationPreferencesModel = model('NotificationPreferences', notificationPreferencesSchema);
