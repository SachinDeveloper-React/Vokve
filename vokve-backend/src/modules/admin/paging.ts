import { z } from 'zod';

/**
 * Paging, the same way everywhere on the operator surface.
 *
 * Every list here answers `{ total, limit, offset, data }` and reads
 * `?limit=&offset=`, because the panel has one pager component and it needs
 * one shape to draw: how many there are, where this page starts, and how
 * long it is. A list that answered its rows alone could not say "page 3 of
 * 7", and a panel that counted the rows it was given would say "7 of 7" on
 * every page.
 *
 * The ceiling matters more than the default. `limit` is clamped rather than
 * trusted because the query string is somebody's address bar: without it,
 * `?limit=999999` is a request to read a whole collection into memory,
 * aggregate it row by row and serialise the lot — which is the load this
 * surface is trying not to put on the database.
 */

/** The two fields, to spread into a query schema. */
export const pageFields = (defaultLimit: number, max = 100) => ({
  limit: z.coerce.number().int().min(1).max(max).default(defaultLimit),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * The same two separately, for one answer carrying two lists.
 *
 * `/admin/training` is the case: the gym is exercises *and* templates, read
 * together because each decides what can be done to the other, and one
 * `offset` cannot mean both. That query names them `exerciseOffset` and
 * `templateOffset` instead — names an operator can read in a link they were
 * sent.
 */
export const limitField = (defaultLimit: number, max = 100) =>
  z.coerce.number().int().min(1).max(max).default(defaultLimit);
export const offsetField = () => z.coerce.number().int().min(0).max(100_000).default(0);

export type PageQuery = { limit: number; offset: number };

/** Where a page starts and ends, for a list already held in memory. */
export const slice = <T>(rows: T[], query: PageQuery): T[] =>
  rows.slice(query.offset, query.offset + query.limit);

/**
 * The envelope. `nextCursor` is null and stays there: these lists are paged
 * by offset because they have a total and "page 3 of 7" is what an operator
 * wants to be able to say, and the field is kept so every list on this
 * surface still has one shape.
 */
export const page = <T>(data: T[], total: number, query: PageQuery) => ({
  total,
  limit: query.limit,
  offset: query.offset,
  data,
  nextCursor: null,
});
