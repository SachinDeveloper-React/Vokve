import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Database } from 'lucide-react-native';
import type { StepSourcesReport } from '../../types/models';
import { useTheme } from '../../theme';
import { formatGrouped } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';

interface Props {
  records: StepSourcesReport['records'];
}

/**
 * The raw Health Connect records the server holds for the day, app by app —
 * what the phones sent inside their signed snapshots, before any matching.
 */
export const SourceRecordsCard = memo(({ records }: Props) => {
  const { colors } = useTheme();

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <HStack align="center" gap="md">
          <IconBadge icon={Database} tint={colors.avatarCyan} shape="rounded" />
          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong">Raw records</AppText>
            <AppText variant="caption" color="textSecondary">
              Health Connect records the server received
            </AppText>
          </VStack>
        </HStack>

        {records.length === 0 ? (
          <AppText variant="caption" color="textSecondary">
            No Health Connect records for this day.
          </AppText>
        ) : (
          records.map((entry, index) => (
            <VStack key={entry.packageName} gap="sm">
              {index > 0 ? <Divider /> : null}
              <HStack align="center" gap="sm">
                <AppText variant="body" numberOfLines={1} style={styles.name}>
                  {entry.appName}
                </AppText>
                <AppText variant="bodyStrong">
                  {`${formatGrouped(entry.steps)} steps`}
                </AppText>
              </HStack>
              <AppText variant="micro" color="textTertiary">
                {[
                  `${formatGrouped(entry.records)} ${
                    entry.records === 1 ? 'record' : 'records'
                  }`,
                  entry.manualSteps > 0
                    ? `${formatGrouped(entry.manualSteps)} typed in`
                    : null,
                  entry.unknownMethodSteps > 0
                    ? `${formatGrouped(
                        entry.unknownMethodSteps,
                      )} with no method stated`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </AppText>
            </VStack>
          ))
        )}
      </VStack>
    </Card>
  );
});

SourceRecordsCard.displayName = 'SourceRecordsCard';

const styles = StyleSheet.create({
  name: { flex: 1 },
});
