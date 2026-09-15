import crypto from 'node:crypto';

export function generateOtp(length: number): string {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, '0');
}

export function hashOtp(code: string, challengeId: string): string {
  return crypto.createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
}

/** "+91••••••3210" / "a•••@example.com" — enough to recognise, not to leak. */
export function maskTarget(target: string, channel: 'sms' | 'email'): string {
  if (channel === 'email') {
    const [local, domain] = target.split('@');
    return `${local.slice(0, 1)}•••@${domain ?? ''}`;
  }
  return `${target.slice(0, 3)}${'•'.repeat(Math.max(0, target.length - 7))}${target.slice(-4)}`;
}
