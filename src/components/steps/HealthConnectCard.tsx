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

/**
 * Health Connect, which is how a watch's steps reach Vokve.
 *
 * Optional, and labelled so: the phone counts on its own, and a card that
 * looked like a required step would push people with no watch through a
 * permission sheet for nothing. Vokve only reads — the card says so, because
 * "health data" on a permission sheet is the line people stop at.
 */
export const HealthConnectCard = memo(
  ({ state, disconnectInApp, onConnect, onManage, onDisconnect }: Props) => {
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
                {state === 'connected'
                  ? 'Reading steps and distance'
                  : 'Steps from a watch or another fitness app'}
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
                Vokve only reads. It never writes to Health Connect. See which
                apps your steps come from on the step sources page.
              </AppText>

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
