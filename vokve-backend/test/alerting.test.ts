import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { getKV } from '../src/db/redis.js';
import * as alerts from '../src/lib/alerts.js';
import { ApiError } from '../src/lib/errors.js';
import { setMailTransport } from '../src/lib/mail.js';
import { classifyMailFailure, warnIfNearMailLimit } from '../src/lib/mailHealth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { app, baseHeaders } from './helpers.js';

/**
 * Knowing the server or the OTP email is broken before a member says so
 * (RULES P20). Each of these used to be a log line and nothing else.
 */

const MAIL_ENV = { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'VOKVE <no-reply@test>' };
const NO_MAIL = { SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, MAIL_FROM: undefined };

afterEach(() => {
  vi.restoreAllMocks();
  setMailTransport(null);
  Object.assign(env, NO_MAIL, {
    MAIL_DAILY_LIMIT: undefined,
    OPS_WEBHOOK_URL: undefined,
    OPS_TELEGRAM_BOT_TOKEN: undefined,
    OPS_TELEGRAM_CHAT_ID: undefined,
    OPS_EMAIL: undefined,
  });
});

const signUp = (n: number) =>
  request(app).post('/v1/auth/sign-up').set(baseHeaders).send({
    email: `alerting${n}@example.com`,
    phone: `+9198765${String(n).padStart(5, '0')}`,
    password: 'walk1000steps',
    dateOfBirth: '1994-03-21',
    gender: 'male',
  });

describe('where an alarm goes', () => {
  let posts: Array<{ url: string; body: Record<string, unknown> }>;
  beforeEach(() => {
    posts = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      posts.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: 200 });
    });
  });

  it('reaches Telegram and a Slack- or Discord-shaped webhook, once an hour per key', async () => {
    Object.assign(env, {
      OPS_WEBHOOK_URL: 'https://hooks.example.com/abc',
      OPS_TELEGRAM_BOT_TOKEN: '123456:telegram-test-token-xyz',
      OPS_TELEGRAM_CHAT_ID: '-100777',
    });

    const sent = await alerts.raiseAlert({ key: 'test.one', severity: 'critical', title: 'Something broke', lines: ['line one'] });
    expect(sent).toBe(true);
    expect(posts).toHaveLength(2);
    const webhook = posts.find(p => p.url === 'https://hooks.example.com/abc')!;
    // `text` for Slack, `content` for Discord — the same URL works with either.
    expect(webhook.body.text).toContain('Something broke');
    expect(webhook.body.content).toBe(webhook.body.text);
    const telegram = posts.find(p => p.url.startsWith('https://api.telegram.org/bot123456:telegram-test-token-xyz/sendMessage'))!;
    expect(telegram.body).toMatchObject({ chat_id: '-100777', text: expect.stringContaining('line one') });

    // The same key inside the hour is quiet.
    expect(await alerts.raiseAlert({ key: 'test.one', severity: 'critical', title: 'Again', lines: [] })).toBe(false);
    expect(posts).toHaveLength(2);
    expect(alerts.alertChannels()).toEqual(['telegram', 'webhook']);
  });

  it('still raises, once, when the KV holding the cooldown is down', async () => {
    Object.assign(env, { OPS_WEBHOOK_URL: 'https://hooks.example.com/abc' });
    vi.spyOn(getKV(), 'setIfAbsent').mockRejectedValue(new Error('redis is gone'));

    expect(await alerts.raiseAlert({ key: 'test.kv-down', severity: 'critical', title: 'Redis down', lines: [] })).toBe(true);
    expect(await alerts.raiseAlert({ key: 'test.kv-down', severity: 'critical', title: 'Redis down', lines: [] })).toBe(false);
    expect(posts).toHaveLength(1);
  });
});

describe('the OTP email failing', () => {
  it('tells somebody, by a channel that is not the broken mail, and the member still gets the 503', async () => {
    const raise = vi.spyOn(alerts, 'raiseAlert').mockResolvedValue(true);
    setMailTransport({
      sendMail: async () => {
        throw Object.assign(new Error('Message rejected'), {
          code: 'EMESSAGE', responseCode: 550, command: 'DATA',
          response: '550-5.4.5 Daily user sending limit exceeded.',
        });
      },
    } as never);
    Object.assign(env, MAIL_ENV);

    const res = await signUp(1);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('EMAIL_UNAVAILABLE');
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({
      key: 'mail.failed:quota',
      severity: 'critical',
      skipEmail: true,
      lines: expect.arrayContaining([expect.stringContaining('5.4.5')]),
    }));
  });

  it('names each way a send fails, so each fix is its own alarm', () => {
    expect(classifyMailFailure({ responseCode: 550, response: '550-5.4.5 Daily user sending limit exceeded' })).toBe('quota');
    expect(classifyMailFailure({ responseCode: 421, response: '421-4.7.0 Try again later, closing connection.' })).toBe('quota');
    expect(classifyMailFailure({ code: 'EAUTH', responseCode: 535, response: '535-5.7.8 Username and Password not accepted' })).toBe('login');
    expect(classifyMailFailure({ code: 'ETIMEDOUT', message: 'Connection timeout' })).toBe('unreachable');
    expect(classifyMailFailure({ responseCode: 553, response: '553 sender address rejected' })).toBe('refused');
  });
});

describe('the OTP email nearing its daily limit', () => {
  it('warns at 80% of the limit, and not before', async () => {
    const raise = vi.spyOn(alerts, 'raiseAlert').mockResolvedValue(true);
    setMailTransport({ sendMail: async () => ({}) } as never);
    Object.assign(env, MAIL_ENV, { MAIL_DAILY_LIMIT: 5 });

    for (let n = 1; n <= 3; n += 1) expect((await signUp(10 + n)).status).toBe(200);
    expect(raise).not.toHaveBeenCalled();

    expect((await signUp(14)).status).toBe(200);
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({
      key: 'mail.quota_near',
      skipEmail: true,
      lines: expect.arrayContaining([expect.stringContaining('4 of about 5')]),
    }));
  });

  it('assumes Gmail’s 500 when the host is Gmail and nothing was said', async () => {
    const raise = vi.spyOn(alerts, 'raiseAlert').mockResolvedValue(true);
    Object.assign(env, MAIL_ENV);
    await warnIfNearMailLimit(399);
    expect(raise).not.toHaveBeenCalled();
    await warnIfNearMailLimit(400);
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ key: 'mail.quota_near', severity: 'warning' }));
    await warnIfNearMailLimit(480);
    expect(raise).toHaveBeenLastCalledWith(expect.objectContaining({ severity: 'critical' }));
  });

  it('stays silent on a host whose limit nobody gave', async () => {
    const raise = vi.spyOn(alerts, 'raiseAlert').mockResolvedValue(true);
    Object.assign(env, MAIL_ENV, { SMTP_HOST: 'email-smtp.ap-south-1.amazonaws.com' });
    await warnIfNearMailLimit(100_000);
    expect(raise).not.toHaveBeenCalled();
  });
});

describe('a 500', () => {
  const failing = () => {
    const a = express();
    a.get('/v1/things/:id', () => {
      throw new TypeError("Cannot read properties of undefined (reading 'steps')");
    });
    a.get('/v1/other/:id', () => {
      throw new RangeError('out of range');
    });
    a.get('/v1/refused', () => {
      throw new ApiError(503, 'EMAIL_UNAVAILABLE', 'Email is not available right now.');
    });
    a.get('/v1/aborted', () => {
      throw Object.assign(new Error('request aborted'), { status: 400, type: 'request.aborted' });
    });
    for (let n = 0; n < 8; n += 1) {
      a.get(`/v1/many/${n}`, () => {
        throw new Error(`failure ${n}`);
      });
    }
    a.use(errorHandler);
    return a;
  };

  it('raises one alarm per route and error, with where it threw', async () => {
    const raise = vi.spyOn(alerts, 'raiseAlert');
    const a = failing();

    const res = await request(a).get('/v1/things/42');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({
      key: 'server.error:GET /v1/things/:id:TypeError',
      title: 'Server error on GET /v1/things/:id',
      lines: expect.arrayContaining([
        expect.stringContaining("TypeError: Cannot read properties of undefined (reading 'steps')"),
        expect.stringMatching(/^At .*alerting\.test\.ts/),
      ]),
    }));

    // The same route failing again inside the hour stays quiet; another route does not.
    await request(a).get('/v1/things/43');
    expect(raise).toHaveBeenCalledTimes(1);
    await request(a).get('/v1/other/1');
    expect(raise).toHaveBeenCalledTimes(2);
  });

  it('is not raised for a refusal the API meant, or a client that hung up', async () => {
    const raise = vi.spyOn(alerts, 'raiseAlert');
    const a = failing();
    expect((await request(a).get('/v1/refused')).status).toBe(503);
    expect((await request(a).get('/v1/aborted')).status).toBe(500);
    expect(raise).not.toHaveBeenCalled();
  });

  it('when everything fails at once, sends five and then one saying there are more', async () => {
    const raise = vi.spyOn(alerts, 'raiseAlert');
    const a = failing();
    for (let n = 0; n < 8; n += 1) await request(a).get(`/v1/many/${n}`);

    const keys = raise.mock.calls.map(([alert]) => alert.key);
    expect(keys).toHaveLength(6);
    expect(keys.slice(0, 5).every(k => k.startsWith('server.error:GET /v1/many/'))).toBe(true);
    expect(keys[5]).toBe('server.error:many');
  });
});

describe('GET /health, for an uptime monitor', () => {
  it('is 200 when the database and the KV both answer', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, mongo: true, redis: true });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('is 503 when the KV does not answer — the status is all a monitor reads', async () => {
    vi.spyOn(getKV(), 'ping').mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, mongo: true, redis: false });
  });
});
