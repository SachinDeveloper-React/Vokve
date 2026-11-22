/**
 * A terminal rendering of the server's JSON log lines, for a human watching
 * `npm run dev`. Every line pino writes still starts life as the same JSON a
 * log collector gets — this only decides how it looks on the way out, so the
 * fields never differ between the two formats.
 *
 *   error / fatal → red      warn → orange      info → green      debug → grey
 *
 * A request line is coloured by its status instead (2xx green, 3xx cyan,
 * 4xx orange, 5xx red) and carries the method, the path, the time it took
 * and, when the answer was an error, its code and message.
 */

const useColor = !('NO_COLOR' in process.env) && process.env.FORCE_COLOR !== '0';

const paint = (code: string) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const colors = {
  red: paint('31'),
  boldRed: paint('1;31'),
  orange: paint('38;5;208'),
  green: paint('32'),
  boldGreen: paint('1;32'),
  cyan: paint('36'),
  grey: paint('90'),
  bold: paint('1'),
};

const LEVELS: Record<number, { label: string; color: (s: string) => string }> = {
  10: { label: 'TRACE', color: colors.grey },
  20: { label: 'DEBUG', color: colors.grey },
  30: { label: 'INFO ', color: colors.green },
  40: { label: 'WARN ', color: colors.orange },
  50: { label: 'ERROR', color: colors.red },
  60: { label: 'FATAL', color: colors.boldRed },
};

/** Fields every line has, or that a request line renders in its own layout. */
const HIDDEN = new Set([
  'level', 'time', 'pid', 'hostname', 'msg', 'err',
  'req', 'res', 'responseTime', 'requestId', 'userId', 'errorCode', 'errorMessage', 'errorDetails',
  'deviceId', 'appVersion', 'platform',
]);

const MAX_VALUE = 300;

function clip(text: string, max = MAX_VALUE): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function clock(time: unknown): string {
  const d = typeof time === 'number' ? new Date(time) : new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function value(v: unknown): string {
  if (typeof v === 'string') return clip(v);
  return clip(JSON.stringify(v) ?? String(v));
}

function extras(line: Record<string, unknown>): string {
  const parts = Object.entries(line)
    .filter(([k, v]) => !HIDDEN.has(k) && v !== undefined)
    .map(([k, v]) => `${k}=${value(v)}`);
  return parts.length ? `  ${colors.grey(parts.join(' '))}` : '';
}

interface SerializedError {
  type?: string;
  message?: string;
  stack?: string;
  code?: string;
}

/** An error's stack under its line, indented; just the message on a warning. */
function errorBlock(err: unknown, level: number, color: (s: string) => string): string {
  if (!err || typeof err !== 'object') return '';
  const e = err as SerializedError;
  // `*.code` is redacted logger-wide (it is where an OTP would sit), so an
  // errno like EADDRINUSE arrives as "[Redacted]" — not worth printing.
  const code = e.code && e.code !== '[Redacted]' ? ` [${e.code}]` : '';
  const head = `${e.type ?? 'Error'}${code}: ${e.message ?? ''}`;
  if (level < 50 || !e.stack) return `\n    ${color(head)}`;
  // Our own frames; the framework's (Express routing, Node internals) are
  // the same on every crash, so they fold into a count.
  const frames = e.stack.split('\n').slice(1).map(l => l.trim()).filter(l => l.startsWith('at '));
  const ours = frames.filter(l => !l.includes('/node_modules/') && !l.includes('node:internal') && !l.includes('(node:'));
  const shown = ours.length ? ours : frames.slice(0, 3);
  const hidden = frames.length - shown.length;
  const stack = [...shown, ...(hidden > 0 ? [`… ${hidden} more in node_modules / node internals`] : [])]
    .map(l => `    ${colors.grey(l)}`)
    .join('\n');
  return `\n    ${color(head)}${stack ? `\n${stack}` : ''}`;
}

function statusColor(status: number): (s: string) => string {
  if (status >= 500) return colors.red;
  if (status >= 400) return colors.orange;
  if (status >= 300) return colors.cyan;
  return colors.green;
}

function statusIcon(status: number): string {
  if (status >= 500) return '✗';
  if (status >= 400) return '⚠';
  return '✓';
}

interface RequestLine {
  level: number;
  time?: number;
  req: { method?: string; url?: string };
  res?: { statusCode?: number };
  responseTime?: number;
  requestId?: string;
  userId?: string;
  platform?: string;
  appVersion?: string;
  errorCode?: string;
  errorMessage?: string;
  errorDetails?: unknown;
  err?: unknown;
}

function requestLine(line: RequestLine): string {
  const status = line.res?.statusCode ?? 0;
  const color = statusColor(status);
  const method = (line.req.method ?? '?').padEnd(6);
  const url = line.req.url ?? '';
  const ms = `${line.responseTime ?? 0}ms`;
  const who = [
    line.userId && `user=${line.userId}`,
    line.platform && `${line.platform}${line.appVersion ? ` ${line.appVersion}` : ''}`,
  ].filter(Boolean).join(' ');

  let out = `${colors.grey(clock(line.time))} ${color(`${statusIcon(status)} ${status}`)} ${colors.bold(method)} ${color(url)} ${colors.grey(ms)}`;
  if (line.errorCode) {
    out += `  ${color(line.errorCode)}`;
    if (line.errorMessage) out += ` ${color('·')} ${line.errorMessage}`;
    if (line.errorDetails) out += `  ${colors.grey(value(line.errorDetails))}`;
  }
  if (who) out += `  ${colors.grey(who)}`;
  // The id the app sees in `x-request-id`, so a failure on the phone can be
  // found here. Only worth the width on a line that went wrong.
  if (status >= 400 && line.requestId) out += `  ${colors.grey(`req=${line.requestId}`)}`;
  if (status >= 500) out += errorBlock(line.err, 50, colors.red);
  return out;
}

export function formatLine(raw: string): string {
  let line: Record<string, unknown>;
  try {
    line = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  }
  const level = typeof line.level === 'number' ? line.level : 30;
  if (line.req && typeof line.responseTime === 'number') {
    return requestLine(line as unknown as RequestLine);
  }
  const { label, color } = LEVELS[level] ?? LEVELS[30]!;
  const msg = typeof line.msg === 'string' ? line.msg : '';
  return `${colors.grey(clock(line.time))} ${color(label)} ${color(msg)}${extras(line)}${errorBlock(line.err, level, color)}`;
}

/** The pino destination: JSON in, coloured text out, written synchronously. */
export function prettyStream(write: (text: string) => void) {
  return {
    write(chunk: string) {
      for (const raw of chunk.split('\n')) {
        if (raw.trim()) write(`${formatLine(raw)}\n`);
      }
    },
  };
}
