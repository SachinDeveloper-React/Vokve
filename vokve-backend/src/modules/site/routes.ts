import { Router } from 'express';
import { siteEnquiryBodySchema } from '../../contracts/site.js';
import { Errors } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { receiveEnquiry, visitorIp } from './enquiries.service.js';
import { serveDocument, servePage, type SitePageKey } from './service.js';

/**
 * The public website's reads (RULES P22): no session, no device headers,
 * open during maintenance (`middleware/maintenance.ts` lets `/v1/site/*`
 * through). A minute's HTTP cache is plenty — the website keeps its own copy
 * for an hour and is told to drop it when something here changes.
 *
 * The paths are the website's contract (`docs/CONTENT_API.md` there), so they
 * are spelled the way it asks, not the way the panel names the pages.
 */
export const siteRouter = Router();

const SERVED: Record<string, SitePageKey> = {
  '/site/config': 'config',
  '/site/pages/home': 'home',
  '/site/pages/about': 'about',
  '/site/pages/contact': 'contact',
  '/site/pages/licenses': 'licenses',
  '/site/pages/invite': 'invite',
  '/site/faqs': 'faq',
  '/site/legal': 'legal',
  '/site/account-deletion': 'deletion',
};

for (const [path, key] of Object.entries(SERVED)) {
  siteRouter.get(path, async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60').json(await servePage(key));
  });
}

siteRouter.get('/site/legal/:slug', async (req, res) => {
  const doc = await serveDocument(String(req.params.slug));
  if (!doc) throw Errors.notFound('That document');
  res.set('Cache-Control', 'public, max-age=60').json(doc);
});

/** The contact form. Answers 201 for a message kept and for one quietly dropped alike. */
siteRouter.post('/site/contact', validate('body', siteEnquiryBodySchema), async (req, res) => {
  res.status(201).set('Cache-Control', 'no-store').json(await receiveEnquiry(req.body, visitorIp(req)));
});
