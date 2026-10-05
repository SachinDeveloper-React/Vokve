import { activityApi } from './api/endpoints';
import { notificationsAllowed } from './push';
import { countingNeedsTurningOn, healthConnectNeedsConnecting } from './steps';

/** How long the set-up waits on the server before it asks for a goal anyway. */
const GOAL_CHECK_TIMEOUT_MS = 4000;

/**
 * The permission screens after sign-in, in the order they ask: physical
 * activity (and counting on), notifications, Health Connect.
 */
export type PermissionStep = 'activity' | 'notifications' | 'healthConnect';

/**
 * The screens this phone still needs, in order. A permission already
 * granted is not asked for again, and one the phone has no use for — Health
 * Connect where it is not supported, physical activity on a phone that
 * cannot count — is not asked for at all. Never throws: a check that fails
 * asks rather than skips, except Health Connect, which is optional.
 */
export async function pendingPermissionSteps(): Promise<PermissionStep[]> {
  const [activity, notifications, healthConnect] = await Promise.all([
    countingNeedsTurningOn().catch(() => true),
    notificationsAllowed().then(
      allowed => !allowed,
      () => true,
    ),
    healthConnectNeedsConnecting().catch(() => false),
  ]);
  const steps: PermissionStep[] = [];
  if (activity) steps.push('activity');
  if (notifications) steps.push('notifications');
  if (healthConnect) steps.push('healthConnect');
  return steps;
}

/**
 * Whether the set-up after sign-in ends on the daily step goal (D-55): only
 * while the account has never chosen one. The goal is the account's, so one
 * chosen on another phone is not asked for again. A server that does not
 * answer in time, or at all, means asking — the goal screen works without
 * it, and asking twice costs a tap where not asking would cost the goal.
 */
export async function stepGoalNeedsChoosing(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      activityApi.goal().then(goal => goal.chosenAt === null),
      new Promise<boolean>(resolve => {
        timer = setTimeout(() => resolve(true), GOAL_CHECK_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}
