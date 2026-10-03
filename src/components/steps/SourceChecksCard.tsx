import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { ListChecks } from 'lucide-react-native';
import type { StepSourcesReport } from '../../types/models';
import { useTheme } from '../../theme';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { IconBadge } from '../ui/IconBadge';
import { ProgressBar } from '../ui/ProgressBar';

interface Props {
  checks: NonNullable<StepSourcesReport['checks']>;
}

/**
 * The fraud layers' own view of the day: each layer's score and every flag
 * raised. Only where the server chooses to show it — in production these
 * would tell a cheater exactly which check caught them.
 */
export const SourceChecksCard = memo(({ checks }: Props) => {
  const { colors } = useTheme();
  const severityTint = {
    hard: colors.destructive,
    soft: colors.warning,
    info: colors.mutedForeground,
  };

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <HStack align="center" gap="md">
          <IconBadge
            icon={ListChecks}
            tint={colors.avatarOrange}
            shape="rounded"
          />
          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong">Checks</AppText>
            <AppText variant="caption" color="textSecondary">
              {checks.plausibility === null
                ? 'Not scored yet'
                : `Score ${checks.plausibility} of 100`}
            </AppText>
          </VStack>
        </HStack>

        <VStack gap="sm">
          {checks.layers.map(layer => (
            <VStack key={layer.key} gap="xxs">
              <HStack align="center" justify="between">
                <AppText variant="caption" color="textSecondary">
                  {layer.name}
                </AppText>
                <AppText variant="caption">
                  {layer.score === null
                    ? 'Nothing to judge'
                    : String(layer.score)}
                </AppText>
              </HStack>
              <ProgressBar
                progress={(layer.score ?? 0) / 100}
                tint={
                  layer.score === null
                    ? colors.mutedForeground
                    : layer.score >= 70
                    ? colors.success
                    : layer.score >= 40
                    ? colors.warning
                    : colors.destructive
                }
              />
            </VStack>
          ))}
        </VStack>

        {checks.flags.length > 0 ? (
          <>
            <Divider />
            <VStack gap="md">
              {checks.flags.map(flag => (
                <HStack key={flag.kind} align="start" gap="sm">
                  <Chip
                    label={flag.severity}
                    tint={severityTint[flag.severity]}
                  />
                  <AppText
                    variant="caption"
                    color="textSecondary"
                    style={styles.message}
                  >
                    {flag.message}
                  </AppText>
                </HStack>
              ))}
            </VStack>
          </>
        ) : null}
      </VStack>
    </Card>
  );
});

SourceChecksCard.displayName = 'SourceChecksCard';

const styles = StyleSheet.create({
  message: { flex: 1 },
});
