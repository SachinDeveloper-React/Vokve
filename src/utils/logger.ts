/**
 * Thin logging facade. Everything goes through here rather than calling
 * `console` directly so that debug noise is stripped from release builds and
 * so the crash reporter can be attached in one place — which it now is: see
 * `setLoggerErrorSink`.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const isDev = __DEV__;

type ErrorSink = (scope: string, message: string, data?: unknown) => void;

/**
 * Where `logger.error` also goes (RULES P17).
 *
 * Registered by `services/errorReporting` at launch rather than imported
 * here, for two reasons: this file is imported by almost everything, so
 * importing a service from it would close a dozen cycles; and a logger that
 * needs the network to log is not a logger.
 *
 * Only `error` is forwarded. A warning is something the app handled — an
 * offline sync, a permission the member refused — and forwarding those would
 * bury the faults in noise.
 */
let errorSink: ErrorSink | null = null;

export function setLoggerErrorSink(sink: ErrorSink | null): void {
  errorSink = sink;
}

function emit(level: Level, scope: string, message: string, data?: unknown) {
  if (level === 'error' && errorSink) {
    try {
      errorSink(scope, message, data);
    } catch {
      // A sink that throws must not take the log with it.
    }
  }
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
