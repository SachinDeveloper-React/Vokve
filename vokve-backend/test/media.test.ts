import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { env } from '../src/config/env.js';
import { setStorageClient } from '../src/lib/storage.js';
import { MediaAssetModel } from '../src/modules/platform/models.js';
import { ShopItemModel } from '../src/modules/commerce/models.js';
import { app } from './helpers.js';

const adminHeaders = () => ({ 'x-admin-key': 'test-admin-key-test-admin-key' });

/**
 * The catalogue's image library (RULES R19).
 *
 * The part worth the most tests is the spreadsheet, because it is the part
 * an operator uses on five hundred products at once and the part where a
 * quiet failure costs the most: a row written without its picture is a gap
 * nobody sees until it is on a shelf, found one item at a time. So a name
 * that matches nothing stops the row, and says which name, in the dry run
 * that exists precisely to be read before anything is written.
 *
 * The bucket is a double. What is being checked is never S3's behaviour —
 * it is that the server asks the bucket what landed rather than believing
 * the panel, which is the only thing standing between a signed upload and
 * a bucket full of whatever anyone cared to put in it.
 */

/** What the bucket says about an object, for the double to answer with. */
let head: { ContentLength: number; ContentType: string } | null = null;
let deleted: string[] = [];

beforeEach(() => {
  env.AWS_REGION = 'ap-south-1';
  env.AWS_S3_BUCKET = 'vokve-test';
  env.AWS_ACCESS_KEY_ID = 'key';
  env.AWS_SECRET_ACCESS_KEY = 'secret';
  env.AWS_S3_PUBLIC_BASE = 'https://cdn.vokve.test';
  head = { ContentLength: 120_000, ContentType: 'image/jpeg' };
  deleted = [];

  setStorageClient({
    async send(command: { constructor: { name: string }; input: { Key: string } }) {
      const name = command.constructor.name;
      if (name === 'HeadObjectCommand') {
        if (!head) throw new Error('NotFound');
        return head;
      }
      if (name === 'DeleteObjectCommand') {
        deleted.push(command.input.Key);
        return {};
      }
      throw new Error(`unexpected ${name}`);
    },
  } as never);
});

afterEach(() => {
  setStorageClient(null);
  env.AWS_REGION = undefined;
  env.AWS_S3_BUCKET = undefined;
  env.AWS_ACCESS_KEY_ID = undefined;
  env.AWS_SECRET_ACCESS_KEY = undefined;
  env.AWS_S3_PUBLIC_BASE = undefined;
});

const confirm = (body: Record<string, unknown>) =>
  request(app).post('/v1/admin/media').set(adminHeaders()).send(body);

describe('recording an upload', () => {
  it('asks the bucket what landed, and reads it back through the CDN', async () => {
    const response = await confirm({
      key: 'shop/2026-11-05/abc.jpg',
      kind: 'shop',
      filename: 'Bottle-750.JPG',
    });

    expect(response.status).toBe(201);
    expect(response.body.url).toBe('https://cdn.vokve.test/shop/2026-11-05/abc.jpg');
    expect(response.body.bytes).toBe(120_000);
    // The filename is kept as written: it is the handle a person has for the
    // file, and the sheet will be matched against it without case.
    expect(response.body.filename).toBe('Bottle-750.JPG');
  });

  it('refuses an upload that never arrived', async () => {
    head = null;
    const response = await confirm({ key: 'shop/x.jpg', kind: 'shop', filename: 'x.jpg' });
    expect(response.status).toBe(404);
    expect(await MediaAssetModel.countDocuments({})).toBe(0);
  });

  it('deletes an oversized object rather than recording it', async () => {
    // A signed PUT cannot carry a size limit, so this is the only place one
    // can be applied — and leaving the object would be a bucket anyone with
    // the panel's key could fill.
    head = { ContentLength: 9 * 1024 * 1024, ContentType: 'image/jpeg' };

    const response = await confirm({ key: 'shop/big.jpg', kind: 'shop', filename: 'big.jpg' });

    expect(response.status).toBe(422);
    expect(deleted).toContain('shop/big.jpg');
    expect(await MediaAssetModel.countDocuments({})).toBe(0);
  });

  it('deletes anything that is not an image', async () => {
    head = { ContentLength: 2_000, ContentType: 'application/pdf' };

    const response = await confirm({ key: 'shop/doc.jpg', kind: 'shop', filename: 'doc.jpg' });

    expect(response.status).toBe(422);
    expect(deleted).toContain('shop/doc.jpg');
  });
});

describe('removing one from the library', () => {
  it('is refused while a product still shows it', async () => {
    const created = await confirm({ key: 'shop/a.jpg', kind: 'shop', filename: 'a.jpg' });
    await ShopItemModel.create({
      _id: 'bottle',
      title: 'Bottle',
      price: 49900,
      category: 'gym',
      images: [created.body.url],
    });

    const response = await request(app)
      .delete(`/v1/admin/media/${created.body.id}`)
      .set(adminHeaders())
      .send();

    // A shelf drawing a broken picture is worse than a shelf with none, and
    // whoever deleted it would never learn which item they had spoiled.
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('MEDIA_IN_USE');
    expect(deleted).toHaveLength(0);
  });
});

describe('a spreadsheet that names its images', () => {
  const importRows = (rows: unknown[], dryRun = true) =>
    request(app).post('/v1/admin/shop/items/import').set(adminHeaders()).send({ rows, dryRun });

  it('matches a filename against the library, without case', async () => {
    await confirm({ key: 'shop/a.jpg', kind: 'shop', filename: 'Bottle-750.JPG' });

    const response = await importRows([
      { line: 2, title: 'Travel Bottle', price: 49900, category: 'gym', images: ['bottle-750.jpg'] },
    ], false);

    expect(response.status).toBe(200);
    expect(response.body.failed).toEqual([]);
    const item = await ShopItemModel.findById('travel-bottle').lean();
    expect(item?.images).toEqual(['https://cdn.vokve.test/shop/a.jpg']);
  });

  it('stops a row whose image was never uploaded, and says which', async () => {
    const response = await importRows([
      { line: 7, title: 'Yoga Mat', price: 99900, category: 'gym', images: ['mat.jpg'] },
    ]);

    expect(response.body.created).toBe(0);
    expect(response.body.failed[0].line).toBe(7);
    // The name is in the message: "something is missing" sends an operator
    // hunting through five hundred rows for it.
    expect(response.body.failed[0].reason).toContain('mat.jpg');
  });

  it('lets a full URL through untouched', async () => {
    // Somebody already hosting their photos should not have to re-upload
    // them to use the importer.
    const response = await importRows([
      {
        line: 3,
        title: 'Shaker',
        price: 29900,
        category: 'gym',
        images: ['https://images.example.com/shaker.png'],
      },
    ], false);

    expect(response.body.failed).toEqual([]);
    const item = await ShopItemModel.findById('shaker').lean();
    expect(item?.images).toEqual(['https://images.example.com/shaker.png']);
  });
});
