import React, { memo } from 'react';
import { Footprints } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { formatGrouped } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { IconBadge } from '../ui/IconBadge';

/** Where counting stands, as this card words it. */
export type CountingState = 'unsupported' | 'off' | 'running' | 'paused';

interface Props {
  state: CountingState;
  /** Today's count, from whichever source answered for it. */
  steps: number;
  /** That source — "this phone", "Fitbit". Null before the first reading. */
  sourceName: string | null;
  /** The user's other phones' steps today, shown with this phone's (D-53). */
  otherDevicesSteps?: number;
  /** The last request for physical activity was refused. */
  permissionDenied: boolean;
  /** An action is in flight; its buttons wait for it. */
  busy: boolean;
  onTurnOn: () => void;
  onPause: () => void;
  onResume: () => void;
  onTurnOff: () => void;
  onOpenSettings: () => void;
}

const STATUS: Record<CountingState, string> = {
  unsupported: 'Unavailable',
  off: 'Off',
  running: 'On',
  paused: 'Paused',
};

/**
 * Counting itself: whether it is on, what it has counted today, and the one
 * switch that matters.
 *
 * Off, the card says what turning it on means before it asks — the sensor,
 * the notification, the app closed — because the permission dialog that
 * follows says none of that, and a fitness app that asks for "physical
 * activity" with no word of why is one people refuse.
 */
export const StepCountingCard = memo(
  ({
    state,
    steps,
    sourceName,
    otherDevicesSteps = 0,
    permissionDenied,
    busy,
    onTurnOn,
    onPause,
    onResume,
    onTurnOff,
    onOpenSettings,
  }: Props) => {
    const { colors } = useTheme();
    const tint =
      state === 'running'
        ? colors.success
        : state === 'paused'
        ? colors.warning
        : colors.mutedForeground;

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack align="center" gap="md">
            <IconBadge icon={Footprints} tint={tint} shape="rounded" />
            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong">Step counting</AppText>
              <AppText variant="caption" color="textSecondary">
                {state === 'running' || state === 'paused'
                  ? otherDevicesSteps > 0
                    ? `${formatGrouped(
                        steps + otherDevicesSteps,
                      )} steps today — ${formatGrouped(steps)} counted by ${
                        sourceName ?? 'this phone'
                      }, ${formatGrouped(
                        otherDevicesSteps,
                      )} by your other phones`
                    : `${formatGrouped(steps)} steps today${
                        sourceName ? `, counted by ${sourceName}` : ''
                      }`
                  : state === 'unsupported'
                  ? 'Not available on this phone yet'
                  : 'Turn it on to count every walk'}
              </AppText>
            </VStack>
            <Chip label={STATUS[state]} tint={tint} />
          </HStack>

          {state === 'off' ? (
            <AppText variant="caption" color="textSecondary">
              Vokve counts your steps with your phone's own motion sensor, even
              when the app is closed. A small notification shows while it
              counts, and you can turn it off here at any time.
            </AppText>
          ) : null}

          {state === 'paused' ? (
            <AppText variant="caption" color="textSecondary">
              Steps taken while paused are not counted.
            </AppText>
          ) : null}

          {state === 'unsupported' ? (
            <AppText variant="caption" color="textSecondary">
              Step counting needs an Android phone for now. Support for iPhone
              is on its way.
            </AppText>
          ) : null}

          {state === 'off' && permissionDenied ? (
            <VStack gap="sm">
              <AppText variant="caption" color="warning">
                Vokve needs the Physical activity permission to count steps. If
                the dialog no longer appears, allow it in settings.
              </AppText>
              <Button
                label="Open settings"
                variant="secondary"
                size="sm"
                onPress={onOpenSettings}
              />
            </VStack>
          ) : null}

          {state === 'off' ? (
            <Button
              label="Turn on step counting"
              variant="brand"
              fullWidth
              loading={busy}
              onPress={onTurnOn}
            />
          ) : null}

          {state === 'running' || state === 'paused' ? (
            <HStack gap="sm">
              <VStack flex={1}>
                <Button
                  label={state === 'running' ? 'Pause' : 'Resume'}
                  variant={state === 'running' ? 'secondary' : 'brand'}
                  size="sm"
                  fullWidth
                  disabled={busy}
                  onPress={state === 'running' ? onPause : onResume}
                />
              </VStack>
              <VStack flex={1}>
                <Button
                  label="Turn off"
                  variant="ghost"
                  size="sm"
                  fullWidth
                  disabled={busy}
                  onPress={onTurnOff}
                />
              </VStack>
            </HStack>
          ) : null}
        </VStack>
      </Card>
    );
  },
);

StepCountingCard.displayName = 'StepCountingCard';
