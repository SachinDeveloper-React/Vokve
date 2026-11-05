import { getPerformance, trace } from '@react-native-firebase/perf';
import { logger } from '../utils/logger';

/**
 * How long the things that matter actually take, on real phones (RULES P17).
 *
 * Firebase Performance was already in this app and was already collecting
 * what it collects for free: cold start, and the duration of every HTTP
 * request. Neither answers the question support is asked. "Sync is slow"
 * is not one request — it is reading a week of days off a native service,
 * signing each one, and posting them — and a p95 on `POST /activity/steps`
 * says nothing about the two thirds of that time spent before the request
 * was made.
 *
 * So the traces here are flows, not calls. Each one is a thing a member
 * waits for, measured end to end, with the figures that explain a slow one
 * attached as metrics — how many days were in the batch, how many items in
 * the queue — because a sync that took nine seconds for forty days is
 * healthy and one that took nine seconds for one day is not.
 *
 * Every function is best-effort and silent. A build with no Firebase, a
 * device where the SDK will not start, a trace the native side refuses:
 * none of them may interfere with the work being measured, and none of
 * them is worth a line in front of a member.
 */

/**
 * The flows worth their own trace. Names are the ones in the console.
 *
 * One, because one is instrumented. A union listing flows nobody measures
 * reads as a plan, and a plan in a type is a promise the code does not keep
 * — adding a name beside a `measure` call is a line when a flow earns one.
 */
export type TraceName = 'steps_sync';

export interface Span {
  /** A number the console can aggregate — days in a batch, items in a queue. */
  metric(name: string, value: number): void;
  /** A label the console can group by — the outcome, the source. */
  attribute(name: string, value: string): void;
  stop(): void;
}

/** Does nothing, successfully. Returned whenever the real thing is unavailable. */
const NOTHING: Span = {
  metric: () => {},
  attribute: () => {},
  stop: () => {},
};

function performance() {
  try {
    return getPerformance();
  } catch {
    // No Firebase on this build — an emulator without Play services, or a
    // fork with no google-services.json.
    return null;
  }
}

/**
 * Starts a trace. Always returns something safe to call `stop` on.
 *
 * The caller is not asked to handle a failure because there is nothing
 * useful it could do: a measurement that cannot be taken is not a reason to
 * skip the work being measured. Private: everything measured so far is
 * async, and `measure` records how it ended as well as how long it took.
 */
function startSpan(name: TraceName): Span {
  const perf = performance();
  if (!perf) return NOTHING;

  try {
    const span = trace(perf, name);
    span.start();
    let stopped = false;

    return {
      metric(metricName, value) {
        // Firebase takes integers; a fractional metric is silently dropped,
        // which is worse than a rounded one.
        try {
          if (!stopped) span.putMetric(metricName, Math.round(value));
        } catch (error) {
          logger.debug('perf', `Metric ${metricName} refused`, error);
        }
      },
      attribute(attributeName, value) {
        try {
          // The SDK caps an attribute at 100 characters and drops the whole
          // trace on a longer one.
          if (!stopped) span.putAttribute(attributeName, value.slice(0, 100));
        } catch (error) {
          logger.debug('perf', `Attribute ${attributeName} refused`, error);
        }
      },
      stop() {
        if (stopped) return;
        stopped = true;
        try {
          span.stop();
        } catch (error) {
          logger.debug('perf', `Trace ${name} would not stop`, error);
        }
      },
    };
  } catch (error) {
    logger.debug('perf', `Trace ${name} would not start`, error);
    return NOTHING;
  }
}

/**
 * Measures an async flow and records how it ended.
 *
 * The outcome is an attribute rather than two trace names, so the console
 * can compare a failing sync's duration with a succeeding one's — which is
 * the comparison that tells a timeout from a slow phone.
 */
export async function measure<T>(
  name: TraceName,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  const span = startSpan(name);
  try {
    const result = await run(span);
    span.attribute('outcome', 'ok');
    return result;
  } catch (error) {
    span.attribute('outcome', 'failed');
    throw error;
  } finally {
    span.stop();
  }
}
