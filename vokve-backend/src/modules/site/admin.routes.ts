import type { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { guardedRouter } from '../staff/guard.js';
import {
  createDocument,
  deleteDocument,
  documentCreateBody,
  documentDeleteBody,
  documentForEdit,
  documentSaveBody,
  listDocuments,
  pageForEdit,
  pageSaveBody,
  pageSpec,
  refreshWholeSite,
  resetBody,
  resetDocument,
  resetPage,
  restoreBody,
  restoreDocument,
  restorePage,
  revisions,
  saveDocument,
  savePage,
  siteOverview,
} from './admin.service.js';
import {
  deleteEnquiry,
  enquiryPatch,
  enquiryQuery,
  enquiryReplyBody,
  getEnquiry,
  listEnquiries,
  replyToEnquiry,
  updateEnquiry,
} from './enquiries.service.js';

/** The panel's Website section (RULES P22): pages, documents, history, and the contact form's inbox. */
export const adminSiteRouter = guardedRouter();

adminSiteRouter.get('/admin/site', async (_req, res) => {
  res.json(await siteOverview());
});

adminSiteRouter.post('/admin/site/refresh', async (req, res) => {
  res.json(await refreshWholeSite(req.ctx.adminActor!));
});

// ─── Pages ─────────────────────────────────────────────────────────────────

adminSiteRouter.get('/admin/site/pages/:key', async (req, res) => {
  res.json(await pageForEdit(pageSpec(String(req.params.key))));
});

adminSiteRouter.put('/admin/site/pages/:key', validate('body', pageSaveBody), async (req, res) => {
  res.json(await savePage(req.ctx.adminActor!, pageSpec(String(req.params.key)), req.body));
});

/** Back to the shipped copy. */
adminSiteRouter.delete('/admin/site/pages/:key', validate('body', resetBody), async (req, res) => {
  res.json(await resetPage(req.ctx.adminActor!, pageSpec(String(req.params.key)), req.body));
});

adminSiteRouter.get('/admin/site/pages/:key/revisions', async (req, res) => {
  res.json(await revisions(`page:${pageSpec(String(req.params.key))}`));
});

adminSiteRouter.post('/admin/site/pages/:key/restore', validate('body', restoreBody), async (req, res) => {
  res.json(await restorePage(req.ctx.adminActor!, pageSpec(String(req.params.key)), req.body));
});

// ─── Documents ─────────────────────────────────────────────────────────────

adminSiteRouter.get('/admin/site/documents', async (_req, res) => {
  res.json(await listDocuments());
});

adminSiteRouter.post('/admin/site/documents', validate('body', documentCreateBody), async (req, res) => {
  res.status(201).json(await createDocument(req.ctx.adminActor!, req.body));
});

adminSiteRouter.get('/admin/site/documents/:slug', async (req, res) => {
  res.json(await documentForEdit(String(req.params.slug)));
});

adminSiteRouter.put('/admin/site/documents/:slug', validate('body', documentSaveBody), async (req, res) => {
  res.json(await saveDocument(req.ctx.adminActor!, String(req.params.slug), req.body));
});

adminSiteRouter.delete('/admin/site/documents/:slug', validate('body', documentDeleteBody), async (req, res) => {
  res.json(await deleteDocument(req.ctx.adminActor!, String(req.params.slug), req.body));
});

/** A shipped document back to its shipped words. */
adminSiteRouter.post('/admin/site/documents/:slug/reset', validate('body', resetBody), async (req, res) => {
  res.json(await resetDocument(req.ctx.adminActor!, String(req.params.slug), req.body));
});

adminSiteRouter.get('/admin/site/documents/:slug/revisions', async (req, res) => {
  res.json(await revisions(`doc:${String(req.params.slug)}`));
});

adminSiteRouter.post('/admin/site/documents/:slug/restore', validate('body', restoreBody), async (req, res) => {
  res.json(await restoreDocument(req.ctx.adminActor!, String(req.params.slug), req.body));
});

// ─── Enquiries ─────────────────────────────────────────────────────────────

adminSiteRouter.get('/admin/site/enquiries', validate('query', enquiryQuery), async (req, res) => {
  res.json(await listEnquiries(req.query as unknown as z.infer<typeof enquiryQuery>));
});

adminSiteRouter.get('/admin/site/enquiries/:enquiryId', async (req, res) => {
  res.json(await getEnquiry(String(req.params.enquiryId)));
});

adminSiteRouter.put('/admin/site/enquiries/:enquiryId', validate('body', enquiryPatch), async (req, res) => {
  res.json(await updateEnquiry(req.ctx.adminActor!, String(req.params.enquiryId), req.body));
});

adminSiteRouter.post('/admin/site/enquiries/:enquiryId/replies', validate('body', enquiryReplyBody), async (req, res) => {
  res.json(await replyToEnquiry(req.ctx.adminActor!, String(req.params.enquiryId), req.body));
});

adminSiteRouter.delete('/admin/site/enquiries/:enquiryId', async (req, res) => {
  res.json(await deleteEnquiry(req.ctx.adminActor!, String(req.params.enquiryId)));
});
