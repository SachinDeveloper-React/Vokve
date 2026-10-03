import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { AppWindow, Smartphone, Watch } from 'lucide-react-native';
import type {
  StepSourceDevice,
  StepSourceRow,
  StepSourceStatus,
} from '../../types/models';
import { useTheme, type ThemeShape } from '../../theme';
import {
  formatClockTime,
  formatGrouped,
  formatRelativeDay,
} from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { IconBadge } from '../ui/IconBadge';

interface Props {
  device: StepSourceDevice;
}

type Colors = ThemeShape['colors'];

const STATUS: Record<
  StepSourceStatus,
  { label: string; tint: (colors: Colors) => string }
> = {
  used: { label: 'Used', tint: c => c.success },
  lower: { label: 'Lower', tint: c => c.mutedForeground },
  not_counted: { label: 'Not counted', tint: c => c.warning },
  unverified: { label: 'Not trusted', tint: c => c.warning },
  blocked: { label: 'Blocked', tint: c => c.destructive },
  not_computed: { label: 'Unclear', tint: c => c.mutedForeground },
};

/** One figure of the phone's own count: a label and its number. */
const Figure = memo(
  ({
    label,
    value,
    strong,
  }: {
    label: string;
    value: string;
    strong?: boolean;
  }) => (
    <HStack align="center" justify="between">
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
      <AppText variant={strong ? 'bodyStrong' : 'body'}>{value}</AppText>
    </HStack>
  ),
);

Figure.displayName = 'Figure';

/** One Health Connect app on this phone's day, and what became of it. */
const SourceRow = memo(({ source }: { source: StepSourceRow }) => {
  const { colors } = useTheme();
  const status = STATUS[source.status];

  return (
    <VStack gap="xs">
      <HStack align="center" gap="sm">
        <Icon
          as={
            source.isWearable
              ? Watch
              : source.isPlatform
              ? Smartphone
              : AppWindow
          }
          size="sm"
          color="textSecondary"
        />
        <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
          {source.appName}
        </AppText>
        <Chip label={status.label} tint={status.tint(colors)} />
      </HStack>
      <AppText variant="caption" color="textSecondary">
        {[
          `${formatGrouped(source.steps)} steps`,
          source.manualSteps
            ? `${formatGrouped(source.manualSteps)} typed in`
            : null,
          source.countable !== null
            ? `${formatGrouped(source.countable)} count`
            : null,
          source.ratioToPhone !== null
            ? `${source.ratioToPhone.toFixed(2)}× the phone`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </AppText>
      <AppText variant="micro" color="textTertiary">
        {source.note}
      </AppText>
    </VStack>
  );
});

SourceRow.displayName = 'SourceRow';

const yesNo = (value: boolean | null) =>
  value === null ? 'Unknown' : value ? 'Yes' : 'No';

/**
 * One phone's part in the day: what its own sensor counted and what was
 * taken off, what Health Connect held on it, and what vouched for it. All of
 * it as the server decided — the phone only sent the evidence.
 */
export const SourceDeviceCard = memo(({ device }: Props) => {
  const { colors } = useTheme();
  const { phone } = device;
  const synced = device.syncedAt
    ? `Synced ${formatRelativeDay(device.syncedAt)}, ${formatClockTime(
        device.syncedAt,
      )}`
    : 'Not synced yet';

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <HStack align="center" gap="md">
          <IconBadge icon={Smartphone} tint={colors.primary} shape="rounded" />
          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong" numberOfLines={1}>
              {device.isCurrent ? `${device.name} (this phone)` : device.name}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              {synced}
            </AppText>
          </VStack>
          {device.answeredForDay ? (
            <Chip label="Used for the day" tint={colors.success} />
          ) : null}
        </HStack>

        <VStack gap="xs">
          <Figure
            label="Counted by the phone"
            value={formatGrouped(phone.counted)}
          />
          {phone.recovered > 0 ? (
            <Figure
              label="Added after a gap"
              value={`− ${formatGrouped(phone.recovered)}`}
            />
          ) : null}
          {phone.flagged > 0 ? (
            <Figure
              label="Flagged"
              value={`− ${formatGrouped(phone.flagged)}`}
            />
          ) : null}
          <Figure
            label="Phone's clean count"
            value={formatGrouped(phone.clean)}
          />
          <Figure
            label={
              device.source === 'health_connect'
                ? 'Best count (from Health Connect)'
                : 'Best count (the phone)'
            }
            value={formatGrouped(device.counted)}
            strong
          />
        </VStack>

        <Divider />

        <VStack gap="md">
          <AppText variant="label" color="textSecondary">
            Health Connect apps
          </AppText>
          {device.sourcesNote ? (
            <AppText variant="caption" color="textSecondary">
              {device.sourcesNote}
            </AppText>
          ) : null}
          {device.sources.length === 0 && !device.sourcesNote ? (
            <AppText variant="caption" color="textSecondary">
              No other app recorded steps on this day.
            </AppText>
          ) : null}
          {device.sources.map((source, index) => (
            <VStack key={source.packageName} gap="md">
              {index > 0 ? <Divider /> : null}
              <SourceRow source={source} />
            </VStack>
          ))}
        </VStack>

        <Divider />

        <VStack gap="xs">
          <Figure
            label="Key vouched for by the phone's hardware"
            value={yesNo(device.proof.keyAttested)}
          />
          <Figure
            label="Locked bootloader, maker's system"
            value={yesNo(device.proof.bootVerified)}
          />
          <Figure
            label="Google Play check"
            value={device.proof.playIntegrity ?? 'Not asked'}
          />
          <Figure
            label="Day verified on this phone"
            value={yesNo(device.verified)}
          />
        </VStack>
      </VStack>
    </Card>
  );
});

SourceDeviceCard.displayName = 'SourceDeviceCard';

const styles = StyleSheet.create({
  name: { flex: 1 },
});
