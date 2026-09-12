/**
 * Thin logging facade. Everything goes through here rather than calling
 * `console` directly so that debug noise is stripped from release builds and
 * so a crash reporter (Sentry, Crashlytics) can be attached in one place later.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const isDev = __DEV__;

function emit(level: Level, scope: string, message: string, data?: unknown) {
  if (!isDev && level !== 'error') {
    return;
  }

  const prefix = `[${scope}]`;
  const args = data === undefined ? [prefix, message] : [prefix, message, data];

  switch (level) {
    case 'warn':
      console.warn(...args);
      break;
    case 'error':
      console.error(...args);
      break;
    default:
      console.log(...args);
  }
}

export const logger = {
  debug: (scope: string, message: string, data?: unknown) =>
    emit('debug', scope, message, data),
  info: (scope: string, message: string, data?: unknown) =>
    emit('info', scope, message, data),
  warn: (scope: string, message: string, data?: unknown) =>
    emit('warn', scope, message, data),
  error: (scope: string, message: string, data?: unknown) =>
    emit('error', scope, message, data),
};
