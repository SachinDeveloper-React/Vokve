import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { CalendarDays, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { CoinExpiryUrgency } from '../../stores/coinsStore';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';
import { InfoLabel } from './InfoLabel';

interface Props {
  /** Days until the coins in hand lapse. Zero means they lapse tonight. */
  daysLeft: number;
  /**
   * How loudly to say it. The panel's tint and its one line of advice follow
   * this rather than a threshold of their own, so the day the wallet turns
   * amber is the day the server sends its reminder (RULES E10).
   */
  urgency?: CoinExpiryUrgency;
  onPressAbout: () => void;
  onPressInfo?: () => void;
}

/** What the panel advises, per urgency. One line: the column is narrow. */
const ADVICE: Record<CoinExpiryUrgency, string> = {
  safe: 'Stay active to keep your coins secure.',
  soon: 'Earn coins soon to keep them.',
  urgent: 'Earn coins today or they expire.',
};

/**
 * The countdown that shares the balance card: how long these coins last.
 *
 * It sits beside the balance rather than under it because the two numbers only
 * mean something together — a large balance with a week left on it is a
 * different message from the same balance with three months, and a user who
 * has to scroll to find the second number will read the first one wrong.
 */
export const CoinExpiryPanel = memo(
  ({ daysLeft, urgency = 'safe', onPressAbout, onPressInfo }: Props) => {
    const { colors } = useTheme();
    const tint =
      urgency === 'urgent'
        ? colors.destructive
        : urgency === 'soon'
        ? colors.warning
        : colors.brandAccent;

    return (
      <VStack flex={1} gap="md">
        <InfoLabel label="Coins Expiry" onPressInfo={onPressInfo} />

        <HStack align="center" gap="sm">
          <IconBadge icon={CalendarDays} tint={tint} size={36} />

          <VStack>
            <AppText variant="h2">{daysLeft}</AppText>
            <AppText variant="micro" style={{ color: tint }}>
              {daysLeft === 1 ? 'Day Left' : 'Days Left'}
            </AppText>
          </VStack>
        </HStack>

        <AppText
          variant="caption"
          color={urgency === 'safe' ? 'textSecondary' : 'text'}
        >
          {ADVICE[urgency]}
        </AppText>

        <Pressable
          onPress={onPressAbout}
          feedback="scale"
          accessibilityRole="button"
          accessibilityLabel="About coin expiry"
        >
          {/*
            A hand-built control rather than `Button`: that component is sized
            for a screen's main call to action, and at this column's width its
            padding alone would push the label onto a second line.
          */}
          <Box
            radius="sm"
            px="xs"
            py="xs"
            style={[styles.cta, { backgroundColor: colors.brandAccent }]}
          >
            <HStack align="center" justify="center" gap="xxs">
              <AppText
                variant="micro"
                numberOfLines={1}
                style={{ color: colors.primaryForeground }}
              >
                About Coin Expiry
              </AppText>
              <Icon
                as={ChevronRight}
                size="xs"
                tint={colors.primaryForeground}
              />
            </HStack>
          </Box>
        </Pressable>
      </VStack>
    );
  },
);

CoinExpiryPanel.displayName = 'CoinExpiryPanel';

const styles = StyleSheet.create({
  /** Keeps the tap target usable where the column is at its narrowest. */
  cta: { minHeight: 32, justifyContent: 'center' },
});
