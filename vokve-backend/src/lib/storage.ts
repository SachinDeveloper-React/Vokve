import { randomBytes } from 'node:crypto';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * The catalogue's images (RULES R18).
 *
 * Nothing here ever holds the bytes. The browser is given a signed URL and
 * puts the file to the bucket itself, for two reasons that both matter: the
 * API runs on a platform with a four-and-a-half megabyte body limit, so a
 * four megabyte photo base64'd into a request is refused before any of our
 * code sees it — and an upload that went through the API would spend the
 * function's memory and its wall clock on bytes it does nothing with.
 *
 * What the server keeps is the decision and the record: it names the key, it
 * pins the content type into the signature, and afterwards it asks the
 * bucket what actually landed. A signed PUT cannot enforce a size, so the
 * size is checked after the fact and an oversized object is deleted rather
 * than recorded — the alternative is a bucket anyone with the panel's key
 * can fill.
 */

/** What a catalogue image may be. A `.jpg` that is really a PDF is not one. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

const EXTENSION: Record<ImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** The most one catalogue image may weigh. A product photo is not a RAW file. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** How long a signed upload stands. Long enough to choose a file, not to be passed on. */
const SIGNED_URL_TTL_SECONDS = 300;

let client: S3Client | null = null;

export function isStorageConfigured(): boolean {
  return Boolean(
    env.AWS_REGION && env.AWS_S3_BUCKET && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY,
  );
}

function s3(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: env.AWS_REGION!,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

/** Tests swap the real bucket for a double. */
export function setStorageClient(next: S3Client | null): void {
  client = next;
}

/**
 * A key for one upload.
 *
 * The member's filename is kept as a *label* on the record and never as the
 * key: two operators uploading `bottle.jpg` a week apart would otherwise
 * overwrite each other's product photo, and a filename is also a path —
 * `../` and a leading slash are both things S3 will happily accept into a
 * key and nobody will enjoy later. The random half is what makes a key
 * unguessable, which matters for a bucket served publicly.
 */
export function keyFor(kind: string, type: ImageType): string {
  const day = new Date().toISOString().slice(0, 10);
  return `${kind}/${day}/${randomBytes(16).toString('hex')}.${EXTENSION[type]}`;
}

/** Where a stored object is read back from. */
export function publicUrl(key: string): string {
  const base = env.AWS_S3_PUBLIC_BASE
    ? env.AWS_S3_PUBLIC_BASE.replace(/\/+$/, '')
    : `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com`;
  return `${base}/${key}`;
}

/**
 * A URL the browser may PUT one file to, once.
 *
 * The content type is part of the signature, so a request that sends
 * something else is refused by S3 rather than by us — which is the only
 * refusal that cannot be talked out of.
 */
export async function signUpload(key: string, contentType: ImageType): Promise<string> {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET!,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}

export interface StoredObject {
  bytes: number;
  contentType: string;
}

/** What actually landed, or null if nothing did. */
export async function describeObject(key: string): Promise<StoredObject | null> {
  try {
    const head = await s3().send(
      new HeadObjectCommand({ Bucket: env.AWS_S3_BUCKET!, Key: key }),
    );
    return {
      bytes: head.ContentLength ?? 0,
      contentType: head.ContentType ?? 'application/octet-stream',
    };
  } catch {
    // A missing object is an answer, not a fault: it is what a confirmation
    // for an upload that never completed looks like.
    return null;
  }
}

/** Never throws: a bucket that will not delete must not fail the write that noticed. */
export async function deleteObject(key: string): Promise<void> {
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: env.AWS_S3_BUCKET!, Key: key }));
  } catch (error) {
    logger.warn({ err: error, key }, 'storage.delete_failed');
  }
}
