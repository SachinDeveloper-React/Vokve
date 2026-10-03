import React, { memo } from 'react';
import { History } from 'lucide-react-native';
import type { StepSourcesReport } from '../../types/models';
import { useTheme } from '../../theme';
import { formatClockTime, formatGrouped } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';

interface Props {
  uploads: StepSourcesReport['uploads'];
}

/**
 * Each time a phone sent this day, newest first: how the count grew through
 * the day, and what Google Play said about the phone when it did.
 */
export const SourceUploadsCard = memo(({ uploads }: Props) => {
  const { colors } = useTheme();

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <HStack align="center" gap="md">
          <IconBadge
            icon={History}
            tint={colors.avatarPurple}
            shape="rounded"
          />
          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong">Uploads</AppText>
            <AppText variant="caption" color="textSecondary">
              Each time a phone sent this day
            </AppText>
          </VStack>
        </HStack>

        {uploads.length === 0 ? (
          <AppText variant="caption" color="textSecondary">
            Nothing sent for this day yet.
          </AppText>
        ) : (
          uploads.map((upload, index) => (
            <VStack key={`${upload.at}-${index}`} gap="sm">
              {index > 0 ? <Divider /> : null}
              <HStack align="center" justify="between" gap="sm">
                <VStack gap="xxs">
                  <AppText variant="body">{formatClockTime(upload.at)}</AppText>
                  <AppText variant="micro" color="textTertiary">
                    {upload.playIntegrity
                      ? `${upload.deviceName} · Play: ${upload.playIntegrity}`
                      : upload.deviceName}
                  </AppText>
                </VStack>
                <VStack align="end" gap="xxs">
                  <AppText variant="bodyStrong">
                    {`${formatGrouped(upload.phoneSteps)} on the phone`}
                  </AppText>
                  {upload.shownSteps !== upload.phoneSteps ? (
                    <AppText variant="micro" color="textTertiary">
                      {`${formatGrouped(upload.shownSteps)} shown on it`}
                    </AppText>
                  ) : null}
                </VStack>
              </HStack>
            </VStack>
          ))
        )}
      </VStack>
    </Card>
  );
});

SourceUploadsCard.displayName = 'SourceUploadsCard';
