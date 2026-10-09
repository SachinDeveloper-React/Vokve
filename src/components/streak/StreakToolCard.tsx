import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { RotateCcw, Snowflake } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { formatCoins } from '../../utils/format';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { CoinBadge } from '../wallet/CoinBadge';

interface FreezeProps {
  available: number;
  maxFreezes: number;
  /** True while this tool's own request is in flight. */
  pending?: boolean;
  /** True while the other tool is busy — both wait on one answer. */
  disabled?: boolean;
  onPress: () => void;
}

/**
 * Streak Freeze: the insurance, taken out before a rest day.
 *
 * Blue and quiet against the restore's orange. A freeze is the calm choice —
 * the member is ahead of the problem — and lighting it as loudly as the
 * thing they reach for after a missed day would make the two compete at the
 * one moment the difference matters.
 *
 * Not disabled when none are left. Whether a freeze can help is the server's
 * decision (RULES S4): it refuses with nothing spent and says why, which is
 * a better answer than a dead button with no explanation.
 */
export const StreakFreezeCard = memo(
  ({ available, maxFreezes, pending, disabled, onPress }: FreezeProps) => {
    const { colors, isDark } = useTheme();

    return (
      <Box
        p="base"
        style={[
          styles.panel,
          {
            backgroundColor: withAlpha(colors.primary, isDark ? 0.14 : 0.07),
            borderColor: withAlpha(colors.primary, 0.3),
          },
        ]}
      >
        <HStack align="center" gap="md">
          <Icon as={Snowflake} size="lg" tint={colors.primary} />

          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong">Streak Freeze</AppText>
            <AppText variant="micro" color="textSecondary">
              Pause your streak for a day.
            </AppText>
            <AppText variant="miniMicro" color="textTertiary">
              {`Available  ${available} / ${maxFreezes}`}
            </AppText>
          </VStack>

          <Button
            label="Use Freeze"
            variant="brandOutline"
            size="sm"
            loading={pending}
            disabled={disabled}
            onPress={onPress}
            icon={<Icon as={Snowflake} size="xs" tint={colors.brandAccent} />}
          />
        </HStack>
      </Box>
    );
  },
);

StreakFreezeCard.displayName = 'StreakFreezeCard';

interface RestoreProps {
  costCoins: number;
  /** How many days a restore would bring back; 0 when there is no gap. */
  gapDays: number;
  pending?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/**
 * Restore Streak: what the member reaches for the morning after.
 *
 * Gold, and louder than the freeze above it. This is the moment a streak is
 * most likely to be abandoned altogether, so the way back is the thing the
 * eye lands on.
 *
 * The cost is stated beside the button rather than inside it. A price on a
 * button reads as the thing being bought; the thing being bought is the
 * streak, and the coins are what it takes.
 */
export const StreakRestoreCard = memo(
  ({ costCoins, gapDays, pending, disabled, onPress }: RestoreProps) => {
    const { colors, isDark } = useTheme();

    return (
      <Box
        p="base"
        style={[
          styles.panel,
          {
            backgroundColor: withAlpha(colors.gold, isDark ? 0.14 : 0.08),
            borderColor: withAlpha(colors.gold, 0.35),
          },
        ]}
      >
        <HStack align="center" gap="md">
          <Icon as={RotateCcw} size="lg" tint={colors.gold} />

          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong">Restore Streak</AppText>
            <AppText variant="micro" color="textSecondary">
              {gapDays > 0
                ? `Bring back ${gapDays} missed ${
                    gapDays === 1 ? 'day' : 'days'
                  } using coins.`
                : 'Bring back a missed day using coins.'}
            </AppText>
            <HStack align="center" gap="xs">
              <AppText variant="miniMicro" color="textTertiary">
                Cost
              </AppText>
              <CoinBadge tint={colors.gold} size={14} />
              <AppText variant="miniMicro" color="textTertiary">
                {`${formatCoins(costCoins)} coins`}
              </AppText>
            </HStack>
          </VStack>

          <Button
            label="Restore Day"
            variant="brandOutline"
            size="sm"
            loading={pending}
            disabled={disabled}
            onPress={onPress}
            icon={<Icon as={RotateCcw} size="xs" tint={colors.brandAccent} />}
          />
        </HStack>
      </Box>
    );
  },
);

StreakRestoreCard.displayName = 'StreakRestoreCard';

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
