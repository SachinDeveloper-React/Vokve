import type { UserDoc } from './models.js';

/** A bcrypt hash. Google, Apple and deleted accounts carry strings that never are. */
export const hasPassword = (user: UserDoc) => user.passwordHash.startsWith('$2');
