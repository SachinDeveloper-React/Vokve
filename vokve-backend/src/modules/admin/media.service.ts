import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import {
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  deleteObject,
  describeObject,
  isStorageConfigured,
  keyFor,
  publicUrl,
  signUpload,
  type ImageType,
} from '../../lib/storage.js';
import { AuditLogModel, MediaAssetModel } from '../platform/models.js';
import { ShopItemModel } from '../commerce/models.js';

/** What a library image may belong to. The picker narrows on it. */
export const MEDIA_KINDS = ['shop', 'food', 'plan'] as const;

/**
 * What the panel is told when no bucket is wired.
 *
 * A 503 rather than a 500: nothing is broken, the feature simply has no
 * credentials, and the message says which four to set rather than leaving
 * an operator reading a stack trace.
 */
const storageMissing = () =>
  Errors.conflict(
    'STORAGE_NOT_CONFIGURED',
    'Image storage is not set up. Set AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY on the API.',
  );
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const signUploadBody = z
  .object({
    kind: z.enum(MEDIA_KINDS),
    contentType: z.enum(IMAGE_TYPES),
    /** What it is called on the operator's machine, kept as its label. */
    filename: z.string().trim().min(1).max(160),
  })
  .strict();
export type SignUploadBody = z.infer<typeof signUploadBody>;

export const confirmUploadBody = z
  .object({
    key: z.string().trim().min(1).max(300),
    kind: z.enum(MEDIA_KINDS),
    filename: z.string().trim().min(1).max(160),
  })
  .strict();
export type ConfirmUploadBody = z.infer<typeof confirmUploadBody>;

export interface MediaAssetView {
  id: string;
  key: string;
  url: string;
  filename: string;
  kind: string;
  contentType: string;
  bytes: number;
  uploadedAt: string | null;
}

/**
 * Hands back a URL the panel may put one file to.
 *
 * The key is the server's, never the filename: two operators uploading
 * `bottle.jpg` a week apart would otherwise overwrite each other, and a
 * filename is also a path. The content type is signed in, so S3 refuses
 * anything else without our code being involved.
 */
export async function signMediaUpload(body: SignUploadBody) {
  if (!isStorageConfigured()) throw storageMissing();

  const key = keyFor(body.kind, body.contentType as ImageType);
  return {
    key,
    uploadUrl: await signUpload(key, body.contentType as ImageType),
    /** The panel must send exactly this, or the signature will not match. */
    contentType: body.contentType,
    /** Where it will be readable once it lands. Not usable before that. */
    url: publicUrl(key),
  };
}

/**
 * Records an upload the bucket has confirmed.
 *
 * Asked of the bucket rather than believed: a signed PUT cannot carry a size
 * limit, so this is where one is applied, and an object that never arrived
 * is the shape a failed upload takes. An oversized one is deleted rather
 * than recorded — the alternative is a bucket anyone holding the panel's key
 * can fill with whatever they like.
 */
export async function confirmMediaUpload(
  actor: string,
  body: ConfirmUploadBody,
): Promise<MediaAssetView> {
  if (!isStorageConfigured()) throw storageMissing();

  const stored = await describeObject(body.key);
  if (!stored) throw Errors.notFound('That upload');

  if (stored.bytes > MAX_IMAGE_BYTES) {
    await deleteObject(body.key);
    throw Errors.validation({
      file: `That image is ${Math.round(stored.bytes / 1024 / 1024)} MB. The most a catalogue image may be is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
    });
  }
  if (!IMAGE_TYPES.includes(stored.contentType as ImageType)) {
    await deleteObject(body.key);
    throw Errors.validation({ file: 'That file is not a JPEG, PNG or WebP.' });
  }

  const asset = await MediaAssetModel.create({
    _id: newId('med'),
    key: body.key,
    url: publicUrl(body.key),
    filename: body.filename,
    kind: body.kind,
    contentType: stored.contentType,
    bytes: stored.bytes,
    uploadedBy: actor,
  });

  return view(asset.toObject());
}

export const mediaQuery = z.object({
  kind: z.enum(MEDIA_KINDS).optional(),
  /** Matches the filename, which is the only name a person has for it. */
  q: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type MediaQuery = z.infer<typeof mediaQuery>;

export async function listMedia(query: MediaQuery) {
  const filter: Record<string, unknown> = {};
  if (query.kind) filter.kind = query.kind;
  if (query.q) {
    // Escaped, because a filename may legitimately contain regex characters
    // and a search box is not a place to let one through.
    filter.filename = { $regex: query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }

  const [total, rows] = await Promise.all([
    MediaAssetModel.countDocuments(filter),
    MediaAssetModel.find(filter).sort({ createdAt: -1 }).skip(query.offset).limit(query.limit).lean(),
  ]);

  return { total, limit: query.limit, offset: query.offset, data: rows.map(view) };
}

/**
 * Removes one image from the library and the bucket.
 *
 * Refused while a product still points at it. A shelf drawing a broken
 * picture is worse than a shelf with none, and the operator who deleted it
 * would have no way of knowing which item they had just spoiled.
 */
export async function deleteMedia(actor: string, id: string): Promise<{ deleted: true }> {
  const asset = await MediaAssetModel.findById(id).lean();
  if (!asset) throw Errors.notFound('That image');

  const used = await ShopItemModel.countDocuments({
    $or: [{ imageUrl: asset.url }, { images: asset.url }],
  });
  if (used > 0) {
    throw Errors.conflict(
      'MEDIA_IN_USE',
      `${used} product${used === 1 ? '' : 's'} still show this image. Take it off them first.`,
    );
  }

  await deleteObject(asset.key);
  await MediaAssetModel.deleteOne({ _id: id });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'media.delete',
    subjectType: 'media',
    subjectId: id,
    before: { filename: asset.filename, url: asset.url },
    after: null,
  });

  return { deleted: true };
}

/**
 * Renames one, or moves it to another shelf of the library.
 *
 * The filename is the handle the spreadsheet import matches a row's image
 * column against, so renaming is how a picture uploaded as `IMG_2041.jpg`
 * becomes the `protein-bar.jpg` the sheet names. The URL and the object in
 * the bucket stay exactly as they are: anything already showing it keeps
 * showing it.
 */
export const mediaPatch = z
  .object({
    filename: z.string().trim().min(1).max(160).optional(),
    kind: z.enum(MEDIA_KINDS).optional(),
  })
  .strict()
  .refine(body => body.filename !== undefined || body.kind !== undefined, 'Change something');
export type MediaPatch = z.infer<typeof mediaPatch>;

export async function updateMedia(actor: string, id: string, patch: MediaPatch): Promise<MediaAssetView> {
  const before = await MediaAssetModel.findById(id).lean();
  if (!before) throw Errors.notFound('That image');

  await MediaAssetModel.updateOne({ _id: id }, { $set: patch });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'media.update',
    subjectType: 'media',
    subjectId: id,
    before: { filename: before.filename, kind: before.kind },
    after: { ...patch },
  });

  const after = await MediaAssetModel.findById(id).lean();
  return view(after!);
}

/**
 * The library by filename, for the spreadsheet import.
 *
 * One read for the whole sheet rather than a lookup per row: a two-thousand
 * row import would otherwise be two thousand round trips to answer a
 * question the library could have answered once. Later uploads win a
 * duplicate name, which is the one a person means when they say "I just
 * uploaded it".
 */
export async function mediaByFilename(): Promise<Map<string, string>> {
  const rows = await MediaAssetModel.find({}, { filename: 1, url: 1 })
    .sort({ createdAt: 1 })
    .lean();
  const byName = new Map<string, string>();
  for (const row of rows) byName.set(row.filename.toLowerCase(), row.url);
  return byName;
}

function view(row: {
  _id: string;
  key: string;
  url: string;
  filename: string;
  kind: string;
  contentType: string;
  bytes: number;
  createdAt?: Date;
}): MediaAssetView {
  return {
    id: row._id,
    key: row.key,
    url: row.url,
    filename: row.filename,
    kind: row.kind,
    contentType: row.contentType,
    bytes: row.bytes,
    uploadedAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}
