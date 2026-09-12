import React, { memo } from 'react';
import { RotateCcw, Snowflake } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { formatCoins } from '../../utils/format';
import { Box } from '../layout/Box';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { StreakToolRow } from './StreakToolRow';

interface Props {
  freezesAvailable: number;
  restoreCostCoins: number;
  onPressFreeze: () => void;
  onPressRestore: () => void;
}

/**
 * The two ways to save a streak.
 *
 * Restore is the highlighted row and Freeze is not, even though Freeze is the
 * cheaper tool. A freeze is insurance — the user takes it out calmly, ahead
 * of a rest day. A restore is what they reach for the morning after a missed
 * one, and that is the moment a user is most likely to give the whole thing
 * up; the row is lit so it is the first thing they see.
 *
 * Neither row is disabled here. The store decides whether a freeze or a
 * restore can actually happen and the screen explains the answer in a toast;
 * a greyed-out row would leave "why?" unanswered.
 */
export const StreakToolsCard = memo(
  ({ freezesAvailable, restoreCostCoins, onPressFreeze, onPressRestore }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="xl" padding="md">
        <VStack gap="sm">
          {/* Inset to the rows' own padding so the label lines up with their glyphs. */}
          <Box px="md">
            <AppText variant="label">Streak Tools</AppText>
          </Box>

          <StreakToolRow
            icon={Snowflake}
            tint={colors.primary}
            title="Streak Freeze"
            subtitle="Protect your streak for 24 hours."
            value={`${freezesAvailable} Available`}
            onPress={onPressFreeze}
          />

          <StreakToolRow
            icon={RotateCcw}
            tint={colors.brandAccent}
            title="Streak Restore"
            subtitle="Missed a day? Restore your streak."
            value={`${formatCoins(restoreCostCoins)} Coins`}
            highlighted
            onPress={onPressRestore}
          />
        </VStack>
      </Card>
    );
  },
);

StreakToolsCard.displayName = 'StreakToolsCard';
