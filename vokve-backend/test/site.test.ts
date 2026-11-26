import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { ChallengeDefinitionModel } from '../src/modules/challenges/models.js';
import { SiteEnquiryModel, SiteRevisionModel } from '../src/modules/site/models.js';
import { seed } from '../src/seed/seed.js';
import { app, signUpAndRegister } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

/**
 * The public website, run from the server and edited on the panel (RULES
 * P22, D-114): every page served from a saved copy or the shipped one, held
 * to the shape the website parses, figures filled from config, the policies
 * as documents, and the contact form's messages kept for the team.
 */

const get = (path: string) => request(app).get(`/v1${path}`);
const admin = (method: 'get' | 'put' | 'post' | 'delete', path: string) => request(app)[method](`/v1${path}`).set(ADMIN);

describe('the website’s content (RULES P22)', () => {
  beforeEach(async () => {
    await seed();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    env.SITE_REVALIDATE_URL = undefined;
    env.SITE_REVALIDATE_SECRET = undefined;
  });

  it('serves every page the website reads, with no app headers, before anything is edited', async () => {
    for (const path of [
      '/site/config',
      '/site/pages/home',
      '/site/pages/about',
      '/site/pages/contact',
      '/site/pages/licenses',
      '/site/pages/invite',
      '/site/faqs',
      '/site/legal',
      '/site/account-deletion',
      '/site/legal/privacy',
      '/site/legal/terms',
      '/site/legal/rewards-policy',
      '/site/legal/refund-policy',
      '/site/legal/shipping-policy',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers['cache-control'], path).toBe('public, max-age=60');
    }
    expect((await get('/site/legal/nothing-here')).status).toBe(404);
    expect((await get('/site/pages/nothing')).status).toBe(404);
  });

  it('fills the frame’s contact details and store links from Contact & links', async () => {
    const config = (await get('/site/config')).body;
    expect(config.company).toMatchObject({
      legalName: 'VOKVE Fitness',
      email: 'support@vokve.com',
      grievanceOfficer: { title: 'Grievance Officer', name: null, email: 'support@vokve.com' },
    });
    // Play is listed by default, the App Store is not: no link, so the button says "Coming soon".
    expect(config.stores.android).toMatchObject({ label: 'Google Play', url: 'https://play.google.com/store/apps/details?id=com.vokve.fitness' });
    expect(config.stores.ios).toMatchObject({ label: 'App Store', url: null, note: 'Coming soon' });
    expect(config.social).toEqual([]);
    expect(config.nav.length).toBeGreaterThan(0);
  });

  it('fills the server’s figures and leaves the website’s own tokens for it', async () => {
    const home = (await get('/site/pages/home')).body;
    const running = await ChallengeDefinitionModel.countDocuments({ active: true });
    expect(home.stats).toEqual(
      expect.arrayContaining([
        { value: String(running), label: 'challenges, each with a coin reward' },
        { value: '₹0.25', label: 'what one coin is worth in the shop' },
        { value: '14 days', label: 'to undo an account deletion' },
      ]),
    );
    // The board is the live list, grouped daily → weekly → monthly, in the shipped words.
    expect(home.challenges.items).toHaveLength(running);
    expect(home.challenges.items[0]).toMatchObject({ cadence: 'Daily', rewardLabel: expect.stringMatching(/^[\d,]+ coins$/) });
    expect(home.challenges).not.toHaveProperty('live');
    // The questions are the Help centre's articles, in the order picked.
    expect(home.faq.items.map((item: { id: string }) => item.id)).toEqual([
      'faq-coins-earn',
      'faq-tracking-steps',
      'faq-orders-pay',
      'faq-account-delete',
    ]);
    expect(home.faq).not.toHaveProperty('itemIds');

    const deletion = (await get('/site/account-deletion')).body;
    expect(deletion.graceDays).toBe(14);
    expect(deletion.timeline.map((step: { label: string }) => step.label)).toEqual(['Day 0', 'Days 1–14', 'Day 14']);
    // The support address is the website's to fill, from GET /site/company.
    expect(deletion.noAccess.email).toBe('{{email}}');

    const invite = (await get('/site/pages/invite')).body;
    expect(invite.reward).toEqual({ value: '20 coins', label: 'for you, and 20 for your friend' });

    const rewards = (await get('/site/legal/rewards-policy')).body;
    expect(JSON.stringify(rewards)).toContain('up to 300 coins a day');
    expect(JSON.stringify(rewards)).not.toMatch(/\{\{(dailyCoinCap|coinExpiryDays|coinValue)\}\}/);

    // Change the config and the words follow, and the whole site is asked to re-read.
    env.SITE_REVALIDATE_URL = 'https://vokve.test/api/revalidate';
    env.SITE_REVALIDATE_SECRET = 'site-secret-site-secret';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const saved = await admin('put', '/admin/config').send({ set: { 'account.deletionGraceDays': 30 } });
    expect(saved.status).toBe(200);
    expect(saved.body.website).toBe('done');
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))).toEqual({ tags: ['site'], immediate: true });
    const after = (await get('/site/account-deletion')).body;
    expect(after.graceDays).toBe(30);
    expect(after.hero.subtitle).toContain('30 days ahead');
  });

  it('lists the published policies on the legal hub, then the extra links', async () => {
    const legal = (await get('/site/legal')).body;
    expect(legal.documents.map((doc: { href: string }) => doc.href)).toEqual([
      '/privacy',
      '/terms',
      '/rewards-policy',
      '/refund-policy',
      '/shipping-policy',
      '/delete-account',
      '/licenses',
    ]);
    expect(legal.documents[0]).toMatchObject({ slug: 'privacy', summary: 'What we collect, why, and the controls you have.', icon: 'shield-check' });
    const privacy = (await get('/site/legal/privacy')).body;
    expect(privacy).toMatchObject({ slug: 'privacy', title: 'Privacy Policy' });
    expect(privacy).not.toHaveProperty('published');
    expect(privacy).not.toHaveProperty('listing');
  });

  it('serves the FAQ page from the Help centre, and refreshes it when an article changes', async () => {
    const faq = (await get('/site/faqs')).body;
    expect(faq.items.length).toBeGreaterThan(5);
    expect(faq.categories.map((c: { id: string }) => c.id)).toContain('coins');

    env.SITE_REVALIDATE_URL = 'https://vokve.test/api/revalidate';
    env.SITE_REVALIDATE_SECRET = 'site-secret-site-secret';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const hidden = await admin('put', '/admin/support/faqs/faq-coins-earn').send({ active: false });
    expect(hidden.status).toBe(200);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body)).tags).toEqual(['site:faq', 'site:home']);

    const after = (await get('/site/faqs')).body;
    expect(after.items.map((item: { id: string }) => item.id)).not.toContain('faq-coins-earn');
    // A hidden article drops out of the home page's questions too.
    const home = (await get('/site/pages/home')).body;
    expect(home.faq.items.map((item: { id: string }) => item.id)).not.toContain('faq-coins-earn');
  });
});

describe('editing a page on the panel (RULES P22)', () => {
  beforeEach(async () => {
    await seed();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    env.SITE_REVALIDATE_URL = undefined;
    env.SITE_REVALIDATE_SECRET = undefined;
  });

  it('hands the editor the content, its shape, the icons and every token', async () => {
    const res = await admin('get', '/admin/site/pages/home');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: 'home', label: 'Home', path: '/', revision: 0, isDefault: true, invalid: null });
    expect(res.body.schema.type).toBe('object');
    expect(res.body.schema.properties.faq.properties.itemIds.widget).toBe('faq-ids');
    expect(res.body.schema.properties.howItWorks.properties.steps.items.properties.icon.widget).toBe('icon');
    expect(res.body.icons).toContain('footprints');
    expect(res.body.tokens).toEqual(
      expect.arrayContaining([
        { name: 'graceDays', value: '14', source: 'config' },
        { name: 'email', value: 'support@vokve.com', source: 'contact' },
      ]),
    );
    expect(res.body.faqOptions.length).toBeGreaterThan(5);
    expect((await admin('get', '/admin/site/pages/nothing')).status).toBe(404);

    const overview = (await admin('get', '/admin/site')).body;
    expect(overview.pages).toHaveLength(9);
    expect(overview.documents).toHaveLength(5);
    expect(overview).toMatchObject({ siteUrl: 'https://vokve.com', refresh: 'off', enquiries: { new: 0, open: 0, total: 0 } });
  });

  it('saves, shows it on the site at once, keeps history, restores and goes back to the shipped copy', async () => {
    env.SITE_REVALIDATE_URL = 'https://vokve.test/api/revalidate';
    env.SITE_REVALIDATE_SECRET = 'site-secret-site-secret';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    const opened = (await admin('get', '/admin/site/pages/about')).body;
    const content = structuredClone(opened.content);
    content.hero.title = 'Walking, rewarded';

    const saved = await admin('put', '/admin/site/pages/about').send({ content, revision: 0, note: 'new headline' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ revision: 1, isDefault: false, updatedBy: 'admin', website: 'done' });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))).toEqual({ tags: ['site:about'], immediate: true });
    expect((await get('/site/pages/about')).body.hero.title).toBe('Walking, rewarded');

    // A second editor who opened revision 0 cannot save over it.
    const stale = await admin('put', '/admin/site/pages/about').send({ content: opened.content, revision: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'SITE_EDIT_CONFLICT', details: { revision: 1, updatedBy: 'admin' } });

    content.hero.title = 'Walk more, earn more';
    expect((await admin('put', '/admin/site/pages/about').send({ content, revision: 1 })).status).toBe(200);

    const history = (await admin('get', '/admin/site/pages/about/revisions')).body;
    expect(history.data.map((row: { revision: number; action: string }) => [row.revision, row.action])).toEqual([
      [2, 'saved'],
      [1, 'saved'],
    ]);
    expect(history.data[1].note).toBe('new headline');

    const restored = await admin('post', '/admin/site/pages/about/restore').send({ id: history.data[1].id, revision: 2 });
    expect(restored.status).toBe(200);
    expect(restored.body.revision).toBe(3);
    expect((await get('/site/pages/about')).body.hero.title).toBe('Walking, rewarded');

    const reset = await admin('delete', '/admin/site/pages/about').send({ revision: 3 });
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ isDefault: true, revision: 0 });
    expect((await get('/site/pages/about')).body.hero.title).toBe('We think a good habit should pay you back');
    const after = (await admin('get', '/admin/site/pages/about/revisions')).body.data;
    expect(after[0]).toMatchObject({ revision: 4, action: 'reset' });

    // Saved again from the shipped copy: the count carries on rather than starting at 1 beside the old 1.
    const again = await admin('put', '/admin/site/pages/about').send({ content, revision: 0 });
    expect(again.status).toBe(200);
    expect(again.body.revision).toBe(5);
  });

  it('refuses what the website could not draw, naming the field', async () => {
    const opened = (await admin('get', '/admin/site/pages/home')).body;

    const empty = structuredClone(opened.content);
    empty.hero.title = '';
    const res = await admin('put', '/admin/site/pages/home').send({ content: empty, revision: 0 });
    expect(res.status).toBe(422);
    expect(res.body.error.details['hero.title']).toBe('Cannot be empty.');

    const badLink = structuredClone(opened.content);
    badLink.hero.primaryCta.href = 'javascript:alert(1)';
    const link = await admin('put', '/admin/site/pages/home').send({ content: badLink, revision: 0 });
    expect(link.status).toBe(422);
    expect(link.body.error.details['hero.primaryCta.href']).toMatch(/path/);

    const typo = structuredClone(opened.content);
    typo.stats[0].value = '{{grceDays}} days';
    const token = await admin('put', '/admin/site/pages/home').send({ content: typo, revision: 0 });
    expect(token.status).toBe(422);
    expect(token.body.error.details['stats.0.value']).toMatch(/\{\{grceDays\}\} is not a token/);

    // Nothing was written.
    expect((await admin('get', '/admin/site/pages/home')).body.revision).toBe(0);
  });

  it('shows the manual board when the live one is switched off, and drops unknown keys', async () => {
    const opened = (await admin('get', '/admin/site/pages/home')).body;
    const content = structuredClone(opened.content);
    content.challenges.live = false;
    content.challenges.items = [
      { id: 'x', icon: 'trophy', title: 'Diwali Dash', description: 'Walk 50,000 steps in Diwali week', cadence: 'Festive', rewardLabel: '1,000 coins', badgeLabel: null },
    ];
    content.surprise = 'not in the shape';
    expect((await admin('put', '/admin/site/pages/home').send({ content, revision: 0 })).status).toBe(200);
    const home = (await get('/site/pages/home')).body;
    expect(home.challenges.items).toEqual([content.challenges.items[0]]);
    expect(home).not.toHaveProperty('surprise');
  });
});

describe('documents on the panel (RULES P22)', () => {
  beforeEach(async () => {
    await seed();
  });

  it('creates a page hidden, publishes it to its own address and the hub, and deletes it', async () => {
    const created = await admin('post', '/admin/site/documents').send({ slug: 'cookie-policy', title: 'Cookie Policy' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ slug: 'cookie-policy', title: 'Cookie Policy', published: false, shipped: false, revision: 1 });
    expect((await get('/site/legal/cookie-policy')).status).toBe(404);

    const content = { ...created.body.content, published: true, summary: 'What cookies the website sets.' };
    content.listing = { ...content.listing, summary: 'The cookies the website sets.', icon: 'database' };
    const saved = await admin('put', '/admin/site/documents/cookie-policy').send({ content, revision: 1 });
    expect(saved.status).toBe(200);

    const served = (await get('/site/legal/cookie-policy')).body;
    expect(served).toMatchObject({ slug: 'cookie-policy', title: 'Cookie Policy', summary: 'What cookies the website sets.' });
    const hub = (await get('/site/legal')).body.documents;
    expect(hub.find((doc: { slug: string }) => doc.slug === 'cookie-policy')).toMatchObject({ href: '/cookie-policy', icon: 'database', summary: 'The cookies the website sets.' });

    expect((await admin('delete', '/admin/site/documents/cookie-policy').send({ confirm: 'cookie' })).status).toBe(422);
    const gone = await admin('delete', '/admin/site/documents/cookie-policy').send({ confirm: 'cookie-policy' });
    expect(gone.status).toBe(200);
    expect((await get('/site/legal/cookie-policy')).status).toBe(404);
    // History keeps its last words.
    expect(await SiteRevisionModel.countDocuments({ target: 'doc:cookie-policy', action: 'deleted' })).toBe(1);
  });

  it('starts a copy from another document, and refuses addresses that are taken', async () => {
    const copy = await admin('post', '/admin/site/documents').send({ slug: 'privacy-2027', title: 'Privacy Policy (2027 draft)', copyFrom: 'privacy' });
    expect(copy.status).toBe(201);
    expect(copy.body.content.sections.length).toBeGreaterThan(3);
    expect(copy.body.content.published).toBe(false);

    expect((await admin('post', '/admin/site/documents').send({ slug: 'about', title: 'x' })).body.error.details.slug).toMatch(/site’s own pages/);
    expect((await admin('post', '/admin/site/documents').send({ slug: 'privacy', title: 'x' })).status).toBe(409);
    expect((await admin('post', '/admin/site/documents').send({ slug: 'Bad Slug', title: 'x' })).status).toBe(422);
  });

  it('keeps the shipped policies: the core two cannot be hidden, none can be deleted, each can go back to its shipped words', async () => {
    const privacy = (await admin('get', '/admin/site/documents/privacy')).body;
    const hidden = await admin('put', '/admin/site/documents/privacy').send({ content: { ...privacy.content, published: false }, revision: 0 });
    expect(hidden.status).toBe(422);
    expect(hidden.body.error.details.published).toMatch(/cannot be hidden/);
    expect((await admin('delete', '/admin/site/documents/privacy').send({ confirm: 'privacy' })).body.error.code).toBe('SITE_DOCUMENT_SHIPPED');

    const shipping = (await admin('get', '/admin/site/documents/shipping-policy')).body;
    const off = await admin('put', '/admin/site/documents/shipping-policy').send({ content: { ...shipping.content, published: false }, revision: 0 });
    expect(off.status).toBe(200);
    expect((await get('/site/legal/shipping-policy')).status).toBe(404);
    expect((await get('/site/legal')).body.documents.map((doc: { slug: string }) => doc.slug)).not.toContain('shipping-policy');

    const back = await admin('post', '/admin/site/documents/shipping-policy/reset').send({ revision: 1 });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ isDefault: true, published: true });
    expect((await get('/site/legal/shipping-policy')).status).toBe(200);
  });
});

describe('the contact form (RULES P22)', () => {
  const message = {
    name: 'Asha Rao',
    email: 'Asha@Example.com',
    topic: 'Business or press',
    message: 'We would like to feature VOKVE in our newsletter next month.',
    page: '/contact',
  };

  afterEach(() => {
    env.SITE_REVALIDATE_SECRET = undefined;
  });

  it('keeps a message for the team, links it to a member, and lets the team answer and close it', async () => {
    const member = await signUpAndRegister();
    const sent = await request(app).post('/v1/site/contact').send({ ...message, email: member.email.toUpperCase() });
    expect(sent.status).toBe(201);
    expect(sent.body).toEqual({ received: true });

    const inbox = (await admin('get', '/admin/site/enquiries')).body;
    expect(inbox).toMatchObject({ total: 1, counts: { new: 1 }, emailConfigured: false });
    const row = inbox.data[0];
    expect(row).toMatchObject({ name: 'Asha Rao', email: member.email.toLowerCase(), status: 'new', userId: member.userId, topic: 'Business or press' });

    expect((await admin('put', `/admin/site/enquiries/${row.id}`).send({ status: 'open', note: 'Forwarded to marketing' })).body).toMatchObject({
      status: 'open',
      note: 'Forwarded to marketing',
      handledBy: 'admin',
    });

    // No mail server in tests: sending is refused, logging an answer given elsewhere is not.
    const send = await admin('post', `/admin/site/enquiries/${row.id}/replies`).send({ message: 'Thanks — we will be in touch.', send: true });
    expect(send.status).toBe(503);
    expect(send.body.error.code).toBe('EMAIL_UNAVAILABLE');
    const logged = await admin('post', `/admin/site/enquiries/${row.id}/replies`).send({ message: 'Called them back.', send: false });
    expect(logged.status).toBe(200);
    expect(logged.body).toMatchObject({ status: 'replied', replies: [{ body: 'Called them back.', via: 'logged', by: 'admin' }] });

    // Waiting = new + open; a replied one has left the default view.
    expect((await admin('get', '/admin/site/enquiries')).body.total).toBe(0);
    expect((await admin('get', '/admin/site/enquiries?status=any')).body.total).toBe(1);

    expect((await admin('delete', `/admin/site/enquiries/${row.id}`)).status).toBe(200);
    expect(await SiteEnquiryModel.countDocuments()).toBe(0);
  });

  it('drops a bot’s message without telling it, and refuses what it cannot use', async () => {
    const bot = await request(app).post('/v1/site/contact').send({ ...message, website: 'https://spam.example' });
    expect(bot.status).toBe(201);
    expect(await SiteEnquiryModel.countDocuments()).toBe(0);

    const bad = await request(app).post('/v1/site/contact').send({ name: '', email: 'nope', message: 'hi' });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.details).sort()).toEqual(['email', 'message', 'name']);
    expect((await request(app).post('/v1/site/contact').send({ ...message, extra: 1 })).status).toBe(422);
  });

  it('limits each visitor, believing the website’s word for who that is only with the shared secret', async () => {
    env.SITE_REVALIDATE_SECRET = 'site-secret-site-secret';
    const fromSite = (ip: string, n: number) =>
      request(app)
        .post('/v1/site/contact')
        .set({ 'x-vokve-site-key': 'site-secret-site-secret', 'x-vokve-visitor-ip': ip })
        .send({ ...message, email: `visitor${n}@example.com` });

    for (let n = 0; n < 5; n++) expect((await fromSite('203.0.113.7', n)).status).toBe(201);
    const sixth = await fromSite('203.0.113.7', 5);
    expect(sixth.status).toBe(429);
    // Another visitor through the same website is not held back by the first.
    expect((await fromSite('198.51.100.4', 6)).status).toBe(201);

    // Without the secret the claim is ignored, and the caller's own address is limited.
    const forged = (n: number) =>
      request(app).post('/v1/site/contact').set({ 'x-vokve-visitor-ip': `192.0.2.${n}` }).send({ ...message, email: `forged${n}@example.com` });
    for (let n = 0; n < 5; n++) expect((await forged(n)).status).toBe(201);
    expect((await forged(9)).status).toBe(429);
  });

  it('limits one address to a handful a day, whoever sends them', async () => {
    for (let n = 0; n < 5; n++) {
      const res = await request(app).post('/v1/site/contact').set('x-forwarded-for', `203.0.113.${n}`).send(message);
      expect(res.status).toBe(201);
    }
    // The sixth from the same address is refused even from a fresh visitor.
    env.SITE_REVALIDATE_SECRET = 'site-secret-site-secret';
    const res = await request(app)
      .post('/v1/site/contact')
      .set({ 'x-vokve-site-key': 'site-secret-site-secret', 'x-vokve-visitor-ip': '198.51.100.99' })
      .send(message);
    expect(res.status).toBe(429);
  });
});
