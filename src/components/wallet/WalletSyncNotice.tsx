import React, { memo } from 'react';
import { CloudOff } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { formatClockTime, formatRelativeDay } from '../../utils/format';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';

interface Props {
  /** Why the last sync failed. Nothing is drawn while this is null. */
  error: string | null;
  /** When the figures on screen were last confirmed; null if never. */
  syncedAt: string | null;
  isRetrying: boolean;
  onRetry: () => void;
}

/**
 * The wallet's admission that its numbers may be behind.
 *
 * Drawn only after a sync has failed, and above the balance rather than as a
 * toast: a balance is a number the user acts on, and "as of this morning" is
 * part of what it means. The cached figures stay on screen underneath — a
 * blank wallet on a bad connection would say the coins were gone.
 */
export const WalletSyncNotice = memo(
  ({ error, syncedAt, isRetrying, onRetry }: Props) => {
    const { colors } = useTheme();

    if (error === null) {
      return null;
    }

    const asOf = syncedAt
      ? `Showing figures from ${formatRelativeDay(syncedAt)}, ${formatClockTime(
          syncedAt,
        )}.`
      : 'Showing what was last saved on this phone.';

    return (
      <Box
        bg="card"
        radius="xl"
        p="base"
        bordered
        accessibilityRole="summary"
        accessibilityLabel={`Couldn't refresh your wallet. ${asOf}`}
      >
        <HStack gap="md" align="center">
          <Icon as={CloudOff} size="lg" tint={colors.warning} />
          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong">Couldn't refresh</AppText>
            <AppText variant="caption" color="textSecondary" numberOfLines={2}>
              {`${error} ${asOf}`}
            </AppText>
          </VStack>
          <Button
            label="Retry"
            variant="secondary"
            size="sm"
            loading={isRetrying}
            disabled={isRetrying}
            onPress={onRetry}
          />
        </HStack>
      </Box>
    );
  },
);

WalletSyncNotice.displayName = 'WalletSyncNotice';
