import React, { memo } from 'react';
import { HeartPulse } from 'lucide-react-native';
import type { HealthConnectStatus } from 'react-native-step-tracker-pro';
import { useTheme } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { IconBadge } from '../ui/IconBadge';

/** Which rung of Health Connect's ladder the user is on. */
export type HealthConnectCardState =
  | 'checking'
  | 'unavailable'
  | 'install'
  | 'update'
  | 'connect'
  | 'settings'
  | 'connected';

/**
 * Whether this phone's steps go into Health Connect (D-57): `off` where
 * Vokve does not write — the server's set-up, or a build that does not
 * declare it — `on` once the user allowed it, and `ask` where the user has
 * not, which is everyone who connected before Vokve wrote there.
 */
export type HealthConnectWrites = 'off' | 'on' | 'ask';

const WRITE_STEPS = 'android.permission.health.WRITE_STEPS';

export function healthConnectWrites(
  status: HealthConnectStatus | null,
  enabled: boolean,
): HealthConnectWrites {
  if (
    !enabled ||
    !status ||
    status.undeclaredPermissions?.includes(WRITE_STEPS)
  ) {
    return 'off';
  }
  return status.canWriteSteps ? 'on' : 'ask';
}

/**
 * The rung, from the tracker's status. Steps are what matter: a user who
 * allowed steps and refused distance is connected — the watch's steps are
 * used and its distance worked out from them.
 */
export function healthConnectCardState(
  status: HealthConnectStatus | null,
): HealthConnectCardState {
  if (!status) return 'checking';
  if (status.availability === 'not_supported') return 'unavailable';
  if (status.availability === 'not_installed') return 'install';
  if (status.availability === 'update_required') return 'update';
  if (status.stepsGranted ?? status.canReadSteps ?? status.canRead) {
    return 'connected';
  }
  // Health Connect stops showing its sheet after two refusals; past that,
  // only its own settings screen can grant anything.
  return status.shouldOpenSettings ? 'settings' : 'connect';
}

interface Props {
  state: HealthConnectCardState;
  /** Whether this phone's steps are written there, once connected. */
  writes: HealthConnectWrites;
  /** Asks for the write grant (`ask`). */
  onAllowWrites: () => void;
  /**
   * The app can take its own access away and have it gone at once — Android
   * 13 and below. From Android 14 an app's own revocation only lands when
   * the app is next closed, and a grant made before that is undone with it,
   * so the switch lives in Health Connect's own settings instead.
   */
  disconnectInApp: boolean;
  /** Install, update, ask or open settings — whichever `state` needs. */
  onConnect: () => void;
  onManage: () => void;
  onDisconnect: () => void;
}

const PROMPT: Partial<
  Record<HealthConnectCardState, { message: string; action: string }>
> = {
  install: {
    message:
      'Install Health Connect from the Play Store to use the steps your watch or band records.',
    action: 'Install Health Connect',
  },
  update: {
    message:
      'Your Health Connect needs an update before Vokve can read from it.',
    action: 'Update Health Connect',
  },
  connect: {
    message:
      'Wear a watch or band? Connect Health Connect and Vokve uses its steps whenever it counted more than your phone.',
    action: 'Connect',
  },
  settings: {
    message:
      'Health Connect has stopped asking. Allow Vokve to read your steps in its settings.',
    action: 'Open Health Connect',
  },
};

/** What Vokve does with Health Connect once connected, in a sentence. */
const WRITES_NOTE: Record<HealthConnectWrites, string> = {
  on: "Vokve uses your watch's steps, and adds the steps this phone counts so your other fitness apps see them. Only what you walk while signed in is added. See which apps your steps come from on the step sources page.",
  ask: "Vokve uses your watch's steps. Let it add the steps this phone counts too, so your other fitness apps see them.",
  off: 'Vokve only reads. It never writes to Health Connect. See which apps your steps come from on the step sources page.',
};

/**
 * Health Connect, which is how a watch's steps reach Vokve — and how the
 * steps this phone counts reach the user's other fitness apps (D-57).
 *
 * Optional, and labelled so: the phone counts on its own, and a card that
 * looked like a required step would push people with no watch through a
 * permission sheet for nothing. What Vokve reads and what it writes is said
 * plainly, because "health data" on a permission sheet is the line people
 * stop at.
 */
export const HealthConnectCard = memo(
  ({
    state,
    writes,
    disconnectInApp,
    onConnect,
    onAllowWrites,
    onManage,
    onDisconnect,
  }: Props) => {
    const { colors } = useTheme();
    const prompt = PROMPT[state];

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack align="center" gap="md">
            <IconBadge
              icon={HeartPulse}
              tint={colors.avatarPink}
              shape="rounded"
            />
            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong">Health Connect</AppText>
              <AppText variant="caption" color="textSecondary">
                {state !== 'connected'
                  ? 'Steps from a watch or another fitness app'
                  : writes === 'on'
                  ? 'Reading your watch, adding your phone'
                  : 'Reading steps and distance'}
              </AppText>
            </VStack>
            <Chip
              label={state === 'connected' ? 'Connected' : 'Optional'}
              tint={state === 'connected' ? colors.success : colors.primary}
            />
          </HStack>

          {state === 'unavailable' ? (
            <AppText variant="caption" color="textSecondary">
              Health Connect is not available on this phone. Your phone's own
              count is used.
            </AppText>
          ) : null}

          {prompt ? (
            <VStack gap="md">
              <AppText variant="caption" color="textSecondary">
                {prompt.message}
              </AppText>
              <Button
                label={prompt.action}
                variant="brandOutline"
                size="sm"
                onPress={onConnect}
              />
            </VStack>
          ) : null}

          {state === 'connected' ? (
            <VStack gap="md">
              <AppText variant="caption" color="textSecondary">
                {WRITES_NOTE[writes]}
              </AppText>

              {writes === 'ask' ? (
                <Button
                  label="Add my steps to Health Connect"
                  variant="brandOutline"
                  size="sm"
                  onPress={onAllowWrites}
                />
              ) : null}

              {disconnectInApp ? (
                <HStack gap="sm">
                  <VStack flex={1}>
                    <Button
                      label="Manage"
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onPress={onManage}
                    />
                  </VStack>
                  <VStack flex={1}>
                    <Button
                      label="Disconnect"
                      variant="ghost"
                      size="sm"
                      fullWidth
                      onPress={onDisconnect}
                    />
                  </VStack>
                </HStack>
              ) : (
                <VStack gap="sm">
                  <Button
                    label="Manage access"
                    variant="secondary"
                    size="sm"
                    onPress={onManage}
                  />
                  <AppText variant="micro" color="textTertiary">
                    To disconnect, turn off Vokve in Health Connect's app
                    permissions.
                  </AppText>
                </VStack>
              )}
            </VStack>
          ) : null}
        </VStack>
      </Card>
    );
  },
);

HealthConnectCard.displayName = 'HealthConnectCard';
