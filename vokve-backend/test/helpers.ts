import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed/seed.js';

export const app = createApp();

export const baseHeaders = {
  'x-vokve-platform': 'android',
  'x-vokve-app-version': '1.0.0',
  'x-vokve-build': '1',
  'x-vokve-os-version': '14',
  'x-vokve-timezone': 'Asia/Kolkata',
  'x-vokve-locale': 'en-IN',
};

export interface Session {
  userId: string;
  phone: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  /** The sign-up challenge, kept so a test can prove purpose isolation. */
  signupVerificationId: string;
  signupCode: string;
}

let counter = 0;

/**
 * Sign up (code goes to the email — `otp.signupChannel`), verify it, register
 * a device. With no SMS provider in tests the phone stays unverified and no
 * second challenge is issued.
 */
export async function signUpAndRegister(): Promise<Session> {
  await seed();
  counter += 1;
  const phone = `+9198765${String(43210 + counter).padStart(5, '0')}`;
  const email = `user${counter}@example.com`;

  const signUp = await request(app).post('/v1/auth/sign-up').set(baseHeaders)
    .send({ email, phone, password: 'walk1000steps', dateOfBirth: '1994-03-21', gender: 'female' });
  if (signUp.status !== 200) throw new Error(`sign-up failed: ${JSON.stringify(signUp.body)}`);

  const verify = await request(app).post('/v1/auth/verify-otp').set(baseHeaders)
    .send({ verificationId: signUp.body.verificationId, code: signUp.body.devCode });
  if (verify.status !== 200) throw new Error(`verify failed: ${JSON.stringify(verify.body)}`);

  const register = await request(app).post('/v1/devices/register').set(baseHeaders)
    .set('authorization', `Bearer ${verify.body.tokens.accessToken}`)
    .set('x-vokve-refresh-token', verify.body.tokens.refreshToken)
    .send({ installId: `install-${counter}-${Date.now()}`, vendorId: `vendor-${counter}`, platform: 'android',
      profile: { brand: 'Google', model: 'Pixel 8', osVersion: '14', isEmulator: false, app: { version: '1.0.0', build: '1', bundleId: 'com.vokve' } } });
  if (register.status !== 200) throw new Error(`register failed: ${JSON.stringify(register.body)}`);

  const session: Session = {
    userId: verify.body.user.id,
    phone,
    email,
    accessToken: verify.body.tokens.accessToken,
    refreshToken: verify.body.tokens.refreshToken,
    deviceId: register.body.deviceId,
    signupVerificationId: signUp.body.verificationId,
    signupCode: signUp.body.devCode,
  };
  return session;
}

export function authed(session: Session) {
  return { ...baseHeaders, authorization: `Bearer ${session.accessToken}`, 'x-vokve-device-id': session.deviceId };
}
