import React, { memo } from 'react';
import { CloudUpload } from 'lucide-react-native';
import { useTheme } from '../../theme';
import {
  formatClockTime,
  formatGrouped,
  formatRelativeDay,
} from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';

interface Props {
  syncing: boolean;
  /** Epoch ms of the last day the server took; null before the first. */
  lastSyncedAt: number | null;
  /** Days on the phone the server has not taken yet. */
  pendingDays: number;
  /** Today as the server holds it; null before it has answered. */
  serverToday: { steps: number; verifiedSteps: number } | null;
  /** Why the last sync stopped, worded for the user. */
  error: string | null;
  onSyncNow: () => void;
}

/** "Today, 10:30 AM" — when the server last heard from this phone. */
function formatSyncedAt(at: number): string {
  const iso = new Date(at).toISOString();
  return `${formatRelativeDay(iso)}, ${formatClockTime(iso)}`;
}

/**
 * Where the counted steps have got to: when the server last heard from this
 * phone, and what it holds for today — the figure the dashboard shows, and
 * the verified part coins are paid on. The phone's own live count is on the
 * card above; the two differ by whatever has not been synced yet.
 */
export const StepSyncCard = memo(
  ({
    syncing,
    lastSyncedAt,
    pendingDays,
    serverToday,
    error,
    onSyncNow,
  }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="xl" padding="base">
        <VStack gap="md">
          <HStack align="center" gap="md">
            <IconBadge
              icon={CloudUpload}
              tint={colors.primary}
              shape="rounded"
            />
            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong">Sync</AppText>
              <AppText variant="caption" color="textSecondary">
                {lastSyncedAt
                  ? `Last synced ${formatSyncedAt(lastSyncedAt)}`
                  : 'Not synced yet'}
              </AppText>
            </VStack>
          </HStack>

          {serverToday ? (
            <AppText variant="body">
              {`Server: ${formatGrouped(
                serverToday.steps,
              )} steps today, ${formatGrouped(
                serverToday.verifiedSteps,
              )} verified`}
            </AppText>
          ) : null}

          {pendingDays > 0 ? (
            <AppText variant="caption" color="textSecondary">
              {pendingDays === 1
                ? '1 day is waiting to sync.'
                : `${pendingDays} days are waiting to sync.`}
            </AppText>
          ) : null}

          {error ? (
            <AppText variant="caption" color="warning">
              {error}
            </AppText>
          ) : null}

          <Button
            label="Sync now"
            variant="secondary"
            size="sm"
            loading={syncing}
            onPress={onSyncNow}
          />
        </VStack>
      </Card>
    );
  },
);

StepSyncCard.displayName = 'StepSyncCard';
