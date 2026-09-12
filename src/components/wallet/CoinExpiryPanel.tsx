import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { CalendarDays, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';
import { InfoLabel } from './InfoLabel';

interface Props {
  /** Days until the coins in hand lapse. Zero means they already have. */
  daysLeft: number;
  onPressAbout: () => void;
  onPressInfo?: () => void;
}

/**
 * The countdown that shares the balance card: how long these coins last.
 *
 * It sits beside the balance rather than under it because the two numbers only
 * mean something together — a large balance with a week left on it is a
 * different message from the same balance with three months, and a user who
 * has to scroll to find the second number will read the first one wrong.
 */
export const CoinExpiryPanel = memo(
  ({ daysLeft, onPressAbout, onPressInfo }: Props) => {
    const { colors } = useTheme();

    return (
      <VStack flex={1} gap="md">
        <InfoLabel label="Coins Expiry" onPressInfo={onPressInfo} />

        <HStack align="center" gap="sm">
          <IconBadge icon={CalendarDays} tint={colors.brandAccent} size={36} />

          <VStack>
            <AppText variant="h2">{daysLeft}</AppText>
            <AppText variant="micro" style={{ color: colors.brandAccent }}>
              {daysLeft === 1 ? 'Day Left' : 'Days Left'}
            </AppText>
          </VStack>
        </HStack>

        <AppText variant="caption" color="textSecondary">
          Stay active to keep your coins secure.
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
