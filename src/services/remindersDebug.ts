import { Platform } from 'react-native';
import notifee, {
  AndroidNotificationSetting,
  AuthorizationStatus,
} from '@notifee/react-native';
import { config } from '../constants/config';
import { soundAssetFor } from '../constants/reminderSounds';
import { useNotificationSettingsStore } from '../stores/notificationSettingsStore';
import { useRemindersStore } from '../stores/remindersStore';
import { useSettingsStore } from '../stores/settingsStore';
import { logger } from '../utils/logger';
import { planReminderAlarms, ALARM_BUDGET } from './reminderSchedule';

/**
 * Why a reminder did or did not arrive, written to the console.
 *
 * A reminder plan is the one setting in the app whose whole value is in the
 * future: the only way to test it by hand is to set a time, wait, and see
 * whether anything happens — and when nothing does, every link in the chain
 * is a suspect. The permission, the health switch, quiet hours, the plan
 * itself, what the scheduler worked out, what the OS actually accepted, and
 * whether the channel it accepted has a sound on it. This prints all seven,
 * in that order, so "no notification came" becomes one line to read.
 *
 * Modelled on `services/stepsDebug`, and for the same reason: a native
 * feature that fails quietly needs somewhere to be loud.
 *
 * Development builds only, and only while ⚙ `config.logReminderSchedule` is
 * on. Read-only — nothing here schedules, cancels or changes a thing.
 * It shows in React Native DevTools' console (`j` in Metro) and in
 * `adb logcat -s ReactNativeJS`.
 */

const SCOPE = 'reminders:debug';
/** Lines per console entry: logcat cuts an entry off at about 4 KB. */
const LINES_PER_ENTRY = 25;

const yesNo = (value: boolean | null | undefined) => (value ? 'yes' : 'no');

const STATUS: Record<number, string> = {
  [AuthorizationStatus.NOT_DETERMINED]: 'not asked yet',
  [AuthorizationStatus.DENIED]: 'DENIED',
  [AuthorizationStatus.AUTHORIZED]: 'authorized',
  [AuthorizationStatus.PROVISIONAL]: 'provisional',
};

const ALARM: Record<number, string> = {
  [AndroidNotificationSetting.ENABLED]: 'enabled',
  [AndroidNotificationSetting.DISABLED]: 'DISABLED (reminders will be batched)',
  [AndroidNotificationSetting.NOT_SUPPORTED]: 'not applicable (below Android 12)',
};

const pad2 = (value: number) => String(value).padStart(2, '0');

/** "Sat 07:15, in 3 h 12 m" — both the clock and the wait, since both mislead alone. */
function when(timestamp: number, now: number): string {
  const at = new Date(timestamp);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const minutes = Math.round((timestamp - now) / 60_000);
  const away =
    minutes < 0
      ? `${-minutes} m ago`
      : minutes < 60
        ? `in ${minutes} m`
        : `in ${Math.floor(minutes / 60)} h ${minutes % 60} m`;
  return `${days[at.getDay()]} ${pad2(at.getHours())}:${pad2(at.getMinutes())}, ${away}`;
}

/** One read; a failure is part of the report, never the end of it. */
async function read<T>(call: () => Promise<T>): Promise<T | string> {
  try {
    return await call();
  } catch (error) {
    return error instanceof Error ? `FAILED: ${error.message}` : `FAILED: ${String(error)}`;
  }
}

/**
 * The report, a section per entry of lines. Separate from the logging so it
 * can be read in a test.
 */
export async function reminderReport(now = new Date()): Promise<string[][]> {
  const plan = useRemindersStore.getState().plan;
  const { categories, quietHours } = useNotificationSettingsStore.getState();
  const goalMl = useSettingsStore.getState().dailyWaterGoalMl;

  const settings = await read(() => notifee.getNotificationSettings());
  const held = await read(() => notifee.getTriggerNotifications());
  const channels = Platform.OS === 'android' ? await read(() => notifee.getChannels()) : [];

  // ── Will anything arrive at all ──────────────────────────────────────────
  const gates: string[] = ['── Can a reminder arrive? ─────────────────────'];
  if (typeof settings === 'string') {
    gates.push(`notifee: ${settings}`);
    gates.push('→ The native module did not answer. Rebuild the app (a new');
    gates.push('  native dependency needs `npm run android` / `run ios`,');
    gates.push('  not just a Metro reload).');
  } else {
    const allowed =
      settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
      settings.authorizationStatus === AuthorizationStatus.PROVISIONAL;
    gates.push(`OS permission:     ${STATUS[settings.authorizationStatus] ?? settings.authorizationStatus}`);
    if (Platform.OS === 'android') {
      gates.push(`exact alarms:      ${ALARM[settings.android.alarm] ?? settings.android.alarm}`);
    }
    gates.push(`health category:   ${yesNo(categories.health)}${categories.health ? '' : '  ← OFF: nothing is scheduled (RULES Y6)'}`);
    gates.push(`plan enabled:      ${yesNo(plan?.enabled)}`);
    gates.push(
      `quiet hours:       ${
        quietHours.enabled ? `${quietHours.start}–${quietHours.end}` : 'off'
      }`,
    );
    if (!allowed) {
      gates.push('→ The OS will show nothing for this app. Nothing else below');
      gates.push('  matters until that is granted.');
    }
  }

  // ── The plan ─────────────────────────────────────────────────────────────
  const planLines: string[] = ['── The plan ───────────────────────────────────'];
  if (plan === null) {
    planLines.push('null — the server has not answered yet, or nobody is signed in.');
  } else {
    const on = plan.reminders.filter(reminder => reminder.enabled);
    planLines.push(`sound:       ${plan.sound} → ${describeAsset(plan.sound)}`);
    planLines.push(`vibration:   ${yesNo(plan.vibration)}${Platform.OS === 'ios' ? ' (iOS follows the sound; not ours to set)' : ''}`);
    planLines.push(`repeatDays:  [${plan.repeatDays.join(', ')}]  (0 = Monday)`);
    planLines.push(`goal:        ${goalMl} ml`);
    planLines.push(`times on:    ${on.length} of ${plan.reminders.length}`);
    for (const reminder of plan.reminders) {
      planLines.push(
        `  ${reminder.enabled ? '●' : '○'} ${reminder.time}  ${reminder.slot}`,
      );
    }
  }

  // ── What the scheduler makes of it ───────────────────────────────────────
  const planned = planReminderAlarms(categories.health ? plan : null, {
    now,
    quietHours,
  });
  const alarmLines: string[] = ['── What should be scheduled ───────────────────'];
  alarmLines.push(`${planned.length} alarm(s), budget ${ALARM_BUDGET}`);
  if (planned.length === 0 && plan !== null && plan.enabled) {
    alarmLines.push('→ Nothing, with a plan that is on. One of: health category');
    alarmLines.push('  off, no repeat days, every time switched off, or every');
    alarmLines.push('  time inside quiet hours.');
  }
  for (const alarm of planned.slice(0, 12)) {
    alarmLines.push(`  ${alarm.repeat.padEnd(6)} ${alarm.time}  ${when(alarm.timestamp, now.getTime())}`);
  }
  if (planned.length > 12) alarmLines.push(`  …and ${planned.length - 12} more`);

  // ── What the OS is actually holding ──────────────────────────────────────
  const heldLines: string[] = ['── What the OS is holding ─────────────────────'];
  if (typeof held === 'string') {
    heldLines.push(held);
  } else {
    const ours = held.filter(entry => String(entry.notification.id ?? '').startsWith('vokve.hydration.'));
    heldLines.push(`${ours.length} of this app's reminders (${held.length} trigger notifications in total)`);
    if (ours.length === 0 && planned.length > 0) {
      heldLines.push('→ The scheduler wanted alarms and the OS has none. The sync');
      heldLines.push('  has not run yet, or every create was refused — look for');
      heldLines.push('  "Could not schedule" warnings above.');
    }
    for (const entry of ours.slice(0, 12)) {
      const trigger = entry.trigger as { timestamp?: number };
      heldLines.push(
        `  ${String(entry.notification.id)}  ${
          trigger.timestamp ? when(trigger.timestamp, now.getTime()) : 'no timestamp'
        }`,
      );
    }
  }

  // ── The channel the sound lives on ───────────────────────────────────────
  const channelLines: string[] = ['── Channels (Android) ─────────────────────────'];
  if (Platform.OS !== 'android') {
    channelLines.push('not applicable — iOS puts the sound on each notification.');
  } else if (typeof channels === 'string') {
    channelLines.push(channels);
  } else {
    const ours = channels.filter(channel => channel.id.startsWith('vokve.hydration.'));
    if (ours.length === 0) {
      channelLines.push('none yet — created by the first sync or sound preview.');
    }
    for (const channel of ours) {
      channelLines.push(
        `  ${channel.id}`,
      );
      channelLines.push(
        `    sound=${channel.sound ?? 'none'} vibration=${yesNo(channel.vibration)} importance=${channel.importance} blocked=${yesNo(channel.blocked)}`,
      );
      if (channel.blocked) {
        channelLines.push('    → BLOCKED in Android settings: silent, or not shown at all.');
      }
      if (channel.id.endsWith('.fallback')) {
        channelLines.push('    → This is the fallback: the channel the plan asked for was');
        channelLines.push('      refused, so reminders ring with the default sound. Look');
        channelLines.push('      for a "channel was refused" warning above.');
      }
    }
  }

  return [gates, planLines, alarmLines, heldLines, channelLines];
}

/** What a sound id resolves to on this platform, in words. */
function describeAsset(soundId: string): string {
  const asset = soundAssetFor(soundId);
  if (asset.kind === 'silent') return 'no sound (deliberately)';
  if (asset.kind === 'system') {
    return soundId === 'default'
      ? "the phone's own notification sound"
      : `no audio in this build → the phone's own sound`;
  }
  return Platform.OS === 'ios'
    ? `${asset.name} (must be in the Xcode target, or iOS plays nothing)`
    : `res/raw/${asset.name}`;
}

let running: Promise<void> | null = null;

/**
 * Writes the report. One at a time; a second call while one is in flight
 * joins it rather than printing twice.
 */
export function logReminderDebug(reason: string): Promise<void> {
  if (!__DEV__ || !config.logReminderSchedule) {
    return Promise.resolve();
  }
  if (running) {
    return running;
  }
  running = reminderReport()
    .then(sections => {
      logger.info(SCOPE, `(${reason})`);
      for (const section of sections) {
        for (let i = 0; i < section.length; i += LINES_PER_ENTRY) {
          logger.info(SCOPE, section.slice(i, i + LINES_PER_ENTRY).join('\n'));
        }
      }
    })
    .catch(error => logger.warn(SCOPE, 'Reminder debug report failed', error))
    .finally(() => {
      running = null;
    });
  return running;
}
