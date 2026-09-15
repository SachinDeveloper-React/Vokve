import { userSchema, type User } from '../../contracts/index.js';
import type { UserDoc } from './models.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** The wire shape the client validates — parsed through the shared schema so drift fails here, not on the phone. */
export function toUser(doc: UserDoc | (Record<string, unknown> & { _id: string })): User {
  const u = doc as Record<string, any>;
  return userSchema.parse({
    id: u._id,
    name: u.name ?? '',
    email: u.email,
    avatarUrl: u.avatarUrl ?? null,
    heightCm: u.heightCm ?? null,
    weightKg: u.weightKg ?? null,
    dateOfBirth: u.dateOfBirth ?? null,
    phone: u.phone ?? null,
    profileCompletedAt: iso(u.profileCompletedAt),
    gender: u.gender ?? null,
    goal: u.goal ?? 'stay_active',
    activityLevel: u.activityLevel ?? 'moderate',
    units: u.units ?? 'metric',
    streakDays: u.streakDays ?? 0,
    weeklyGoalWorkouts: u.weeklyGoalWorkouts ?? 4,
    createdAt: iso(u.createdAt),
    country: u.country ?? 'IN',
    phoneVerifiedAt: iso(u.phoneVerifiedAt),
    emailVerifiedAt: iso(u.emailVerifiedAt),
    trustTier: u.trust?.tier ?? 'normal',
  });
}
