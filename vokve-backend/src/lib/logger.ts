import { networkInterfaces } from 'node:os';
import pino from 'pino';
import { env, isTest } from '../config/env.js';
import { colors, prettyStream } from './prettyLog.js';

/**
 * Coloured, one-line-per-event text in a terminal; JSON everywhere else (a
 * hosting panel, a log collector, a pipe). `LOG_FORMAT` overrides the guess.
 */
export const prettyLogs = env.LOG_FORMAT === 'pretty' || (env.LOG_FORMAT === 'auto' && process.stdout.isTTY === true);

const stdout = pino.destination({ dest: 1, sync: true });

export const logger = pino(
  {
    level: isTest ? 'silent' : env.LOG_LEVEL,
    redact: ['req.headers.authorization', '*.password', '*.code', '*.token', '*.refreshToken', 'errorDetails.linkToken'],
  },
  prettyLogs ? prettyStream(text => stdout.write(text)) : stdout,
);

/** The first address another device on the network (a phone) can reach this machine at. */
function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const nic of list ?? []) {
      if (nic.family === 'IPv4' && !nic.internal) return nic.address;
    }
  }
  return undefined;
}

/**
 * Says where the server is listening, once it really is: a framed block in a
 * terminal, one structured line in JSON.
 */
export function logListening(port: number, facts: Record<string, string | number | boolean>, title = 'vokve-backend is running') {
  const local = `http://localhost:${port}`;
  const lan = lanAddress();
  const network = lan ? `http://${lan}:${port}` : undefined;
  if (!prettyLogs) {
    logger.info({ port, url: local, network, ...facts }, `${title} on ${local}`);
    return;
  }
  const rows: Array<[string, string]> = [
    ['Local', colors.bold(local)],
    ...(network ? [['Network', network] as [string, string]] : []),
    ['API', `${local}/v1`],
    ...Object.entries(facts).map(([k, v]) => [k, String(v)] as [string, string]),
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  const body = rows.map(([k, v]) => `  ${colors.green('➜')}  ${colors.grey(`${k}:`.padEnd(width + 2))}${v}`).join('\n');
  stdout.write(`\n  ${colors.boldGreen(`✓ ${title}`)} ${colors.grey(`on port ${port}`)}\n\n${body}\n\n`);
}
