/**
 * RFC 4122 v4 from `Math.random`.
 *
 * Fine for what the app needs one for — an install id, an idempotency key —
 * where the value only has to be unique, not unguessable: the server binds
 * an install id to a session and scopes an idempotency key to a user, so a
 * guessed one buys nothing. `crypto.randomUUID` is not on every Hermes yet.
 */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    // The variant nibble is 8, 9, a or b.
    const nibble = c === 'x' ? r : 8 + (r % 4);
    return nibble.toString(16);
  });
}
