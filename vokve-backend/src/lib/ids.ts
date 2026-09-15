import { v7 as uuidv7 } from 'uuid';

/** Prefixed, time-ordered ids: readable in logs, index-friendly in Mongo. */
export function newId(prefix: string): string {
  return `${prefix}_${uuidv7()}`;
}
