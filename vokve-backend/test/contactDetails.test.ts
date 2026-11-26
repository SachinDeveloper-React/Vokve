import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { getConfig, invalidateConfig } from '../src/config/remote.js';
import { unpinRetiredDefaults } from '../src/config/retired.js';
import { forgetMaintenanceBypass } from '../src/modules/platform/maintenance.js';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { seed } from '../src/seed/seed.js';
import { app, authed, signUpAndRegister } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

/**
 * Contact details and links (RULES P21, D-112): one ⚙ section the app's Help
 * and About screens, the invite links and the public website all read, and
 * the panel edits — checked for form on the way in, so a typo cannot put a
 * dead "Email us" button in front of a member.
 */

const setConfig = (body: Record<string, unknown>) => request(app).put('/v1/admin/config').set(ADMIN).send(body);
const company = () => request(app).get('/v1/site/company');

describe('contact details and links (RULES P21)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    env.SITE_REVALIDATE_URL = undefined;
    env.SITE_REVALIDATE_SECRET = undefined;
    forgetMaintenanceBypass();
  });

  it('serves the website the company’s details on vokve.com, with no app headers', async () => {
    const res = await company();
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.body).toEqual({
      company: {
        legalName: 'VOKVE Fitness',
        email: 'support@vokve.com',
        phone: '+918000000000',
        whatsapp: null,
        hours: 'Mon–Sat, 9 am – 7 pm IST',
        responseTime: 'We usually reply within 24 hours.',
        address: ['VOKVE Fitness', 'India'],
        // No officer's address of their own: complaints go to support.
        grievanceOfficer: { name: null, email: 'support@vokve.com' },
      },
      links: {
        website: 'https://vokve.com',
        privacy: 'https://vokve.com/privacy',
        terms: 'https://vokve.com/terms',
        licenses: 'https://vokve.com/licenses',
      },
      inviteUrlBase: 'https://vokve.com/r',
      stores: {
        android: { url: 'https://play.google.com/store/apps/details?id=com.vokve.fitness', listed: true },
        ios: { url: 'https://apps.apple.com/app/vokve', listed: false },
      },
      social: [],
    });
  });

  it('changes everywhere at once when the panel changes it', async () => {
    const member = await signUpAndRegister();

    const saved = await setConfig({
      set: {
        'support.email': 'help@vokve.com',
        'support.phone': '+919876543210',
        'support.whatsapp': '+919876543210',
        'support.links.website': 'https://www.vokve.com',
        'support.inviteUrlBase': 'https://vokve.in/r/',
        'support.grievanceOfficer.name': 'Priya Sharma',
        'support.social.instagram': 'https://instagram.com/vokve',
        'support.social.youtube': 'https://youtube.com/@vokve',
        'app.storeListed.ios': true,
      },
      note: 'new support desk',
    });
    expect(saved.status).toBe(200);
    // The website refresh hook is not set up in tests: the panel is told the
    // site catches up on its own rather than that it failed.
    expect(saved.body.website).toBe('off');

    // The website's read.
    const site = (await company()).body;
    expect(site.company).toMatchObject({
      email: 'help@vokve.com',
      phone: '+919876543210',
      whatsapp: '+919876543210',
      grievanceOfficer: { name: 'Priya Sharma', email: 'help@vokve.com' },
    });
    expect(site.links.website).toBe('https://www.vokve.com');
    expect(site.stores.ios.listed).toBe(true);
    // Only the profiles that are set, in the fixed order.
    expect(site.social).toEqual([
      { kind: 'instagram', url: 'https://instagram.com/vokve' },
      { kind: 'youtube', url: 'https://youtube.com/@vokve' },
    ]);

    // The app's Help page.
    const help = await request(app).get('/v1/support/home').set(authed(member));
    expect(help.status).toBe(200);
    const channels = help.body.channels.map((c: { kind: string; url: string }) => [c.kind, c.url]);
    expect(channels).toEqual([
      ['email', 'mailto:help@vokve.com'],
      ['phone', 'tel:+919876543210'],
      ['whatsapp', 'https://wa.me/919876543210'],
    ]);

    // The app's About page.
    const about = await request(app).get('/v1/app/about').set(authed(member));
    expect(about.body).toMatchObject({ supportEmail: 'help@vokve.com', links: { website: 'https://www.vokve.com' } });

    // The invite link a member shares — the trailing slash is not doubled.
    const program = await request(app).get('/v1/referrals/me').set(authed(member));
    expect(program.body.shareUrl).toBe(`https://vokve.in/r/${program.body.code}`);
    expect(program.body.shareMessage).toContain(`https://vokve.in/r/${program.body.code}`);
  });

  it('refuses a detail a member could not use, naming the key', async () => {
    const cases: [string, unknown, RegExp][] = [
      ['support.email', 'support at vokve', /email address/],
      ['support.phone', '+91 98765 43210', /international form/],
      ['support.phone', '9876543210', /international form/],
      ['support.whatsapp', '+91-98765-43210', /international form/],
      ['support.links.privacy', 'http://vokve.com/privacy', /https:\/\//],
      ['support.links.terms', 'vokve.com/terms', /https:\/\//],
      ['support.social.instagram', 'instagram.com/vokve', /https:\/\//],
      ['app.storeUrl.android', 'market://details?id=com.vokve.fitness', /https:\/\//],
      ['support.company', '   ', /cannot be empty/],
      ['support.address', [], /at least one line/],
    ];
    for (const [path, value, why] of cases) {
      const res = await setConfig({ set: { [path]: value } });
      expect(res.status, `${path} = ${JSON.stringify(value)}`).toBe(422);
      expect(res.body.error.details[path], path).toMatch(why);
    }

    // The same rules hold when a whole branch is written at once.
    const branch = await setConfig({ set: { 'support.links': { privacy: 'ftp://vokve.com/privacy' } } });
    expect(branch.status).toBe(422);
    expect(branch.body.error.details['support.links.privacy']).toMatch(/https:\/\//);

    // The email always holds a value; the phone may be taken off the page.
    expect((await setConfig({ set: { 'support.email': null } })).status).toBe(422);
    expect((await setConfig({ set: { 'support.phone': null } })).status).toBe(200);
    expect((await company()).body.company.phone).toBeNull();
  });

  it('does not let an old stored value that predates a rule block an unrelated edit', async () => {
    // Somebody's hand-written phone number from before numbers were checked.
    await AppConfigModel.updateOne({ _id: 'support' }, { $set: { 'value.phone': '+91 80000 00000' } }, { upsert: true });
    invalidateConfig();
    const res = await setConfig({ set: { 'support.hours': 'Every day, 8 am – 10 pm IST' } });
    expect(res.status).toBe(200);
  });

  it('asks the website to re-read when a detail changes, and only then', async () => {
    env.SITE_REVALIDATE_URL = 'https://vokve.com/api/revalidate';
    env.SITE_REVALIDATE_SECRET = 'site-secret-site-secret';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    const contact = await setConfig({ set: { 'support.email': 'hello@vokve.com' } });
    expect(contact.body.website).toBe('done');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://vokve.com/api/revalidate');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ tags: ['site:company'], immediate: true }) });
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer site-secret-site-secret');

    // A knob the website does not show is not worth a refresh.
    const shipping = await setConfig({ set: { 'commerce.shippingFeePaise': 5900 } });
    expect(shipping.body.website).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // A site that is down never turns a saved change into an error.
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const down = await setConfig({ reset: ['support.email'] });
    expect(down.status).toBe(200);
    expect(down.body.website).toBe('failed');
    expect((await company()).body.company.email).toBe('support@vokve.com');
  });

  it('stays up for the website while the app is in maintenance', async () => {
    const on = await request(app).put('/v1/admin/maintenance').set(ADMIN).send({ enabled: true });
    expect(on.status).toBe(200);
    expect((await company()).status).toBe(200);
    await request(app).put('/v1/admin/maintenance').set(ADMIN).send({ enabled: false });
  });
});

describe('old defaults pinned by an earlier seed (D-112)', () => {
  it('unpins exactly what an older build shipped, and leaves a typed value alone', async () => {
    await seed();
    // What a database seeded before the move to vokve.com holds.
    await AppConfigModel.updateOne(
      { _id: 'support' },
      {
        $set: {
          'value.email': 'support@vokve.app',
          'value.links.privacy': 'https://vokve.app/privacy',
          'value.links.website': 'https://vokve.app',
          // Somebody's own choice, which happens to name the old domain.
          'value.links.terms': 'https://vokve.app/legal/terms-2026',
        },
      },
    );
    await AppConfigModel.updateOne(
      { _id: 'app' },
      { $set: { 'value.storeUrl.android': 'https://play.google.com/store/apps/details?id=com.vokve' } },
    );
    // The Android package from before com.vokve.fitness: pinned, every
    // phone's key attestation fails as the wrong package.
    await AppConfigModel.updateOne(
      { _id: 'integrity' },
      { $set: { 'value.android.packageName': 'com.vokve' } },
      { upsert: true },
    );
    invalidateConfig();

    const dry = await unpinRetiredDefaults(false);
    expect(dry.unpinned.map(row => row.path).sort()).toEqual([
      'app.storeUrl.android',
      'integrity.android.packageName',
      'support.email',
      'support.links.privacy',
      'support.links.website',
    ]);
    expect(dry.kept).toEqual([{ path: 'support.links.terms', value: 'https://vokve.app/legal/terms-2026' }]);
    // A dry run changes nothing.
    expect((await company()).body.company.email).toBe('support@vokve.app');

    await unpinRetiredDefaults(true);
    const site = (await company()).body;
    expect(site.company.email).toBe('support@vokve.com');
    expect(site.links.privacy).toBe('https://vokve.com/privacy');
    expect(site.links.terms).toBe('https://vokve.app/legal/terms-2026');
    expect(site.stores.android.url).toBe('https://play.google.com/store/apps/details?id=com.vokve.fitness');
    expect((await getConfig()).integrity.android.packageName).toBe('com.vokve.fitness');

    // A second run, and a re-seed, find nothing more to do.
    expect((await unpinRetiredDefaults(true)).unpinned).toEqual([]);
    await seed();
    expect((await company()).body.company.email).toBe('support@vokve.com');
  });
});
