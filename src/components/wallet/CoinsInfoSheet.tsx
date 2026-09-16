import React, { memo } from 'react';
import { ShieldCheck, Sunrise } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { EarnRule } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { formatCoins } from '../../utils/format';
import { BottomSheet } from '../disclosure/BottomSheet';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { EarnCoinsCard } from './EarnCoinsCard';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The rate card as served; null before the first sync. */
  rules: EarnRule[] | null;
  /** The hard per-day ceiling and where today stands against it (RULES E8f). */
  dailyCap: number;
  earnedToday: number;
  remainingToday: number;
  /** Step coins the server is still verifying (RULES E15). */
  pending: number;
  onPressShop: () => void;
}

/**
 * What "Your Coins" are, asked from the "?" on the balance card.
 *
 * Three answers, in the order a new user asks them: how coins are earned
 * (the served rate card — the numbers the owner can change, so never written
 * into the app), how much a day can earn (the cap, and today's headroom, so a
 * user who hits it learns about it here rather than from a ledger row that
 * paid less than expected), and why some coins say "pending".
 */
export const CoinsInfoSheet = memo(
  ({
    visible,
    onClose,
    rules,
    dailyCap,
    earnedToday,
    remainingToday,
    pending,
    onPressShop,
  }: Props) => {
    const { colors, isDark } = useTheme();
    const capReached = remainingToday <= 0 && dailyCap > 0;

    return (
      <BottomSheet visible={visible} onClose={onClose} title="Your coins">
        <VStack gap="base" pb="base">
          <AppText variant="body" color="textSecondary">
            Coins are what moving earns you. Walk, train, keep a streak, finish
            a challenge or bring a friend, and coins land in this wallet to
            spend in the shop.
          </AppText>

          <EarnCoinsCard rules={rules} />

          <Box
            radius="xl"
            p="base"
            style={{
              backgroundColor: withAlpha(
                capReached ? colors.warning : colors.primary,
                isDark ? 0.14 : 0.08,
              ),
            }}
          >
            <HStack align="start" gap="md">
              <Icon
                as={Sunrise}
                size="lg"
                tint={capReached ? colors.warning : colors.primary}
              />
              <VStack flex={1} gap="xxs">
                <AppText variant="bodyStrong">
                  {capReached
                    ? 'Daily limit reached'
                    : `Up to ${formatCoins(dailyCap)} coins a day`}
                </AppText>
                <AppText variant="caption" color="textSecondary">
                  {capReached
                    ? `You have earned today's ${formatCoins(
                        dailyCap,
                      )}. The limit resets at midnight.`
                    : `${formatCoins(
                        earnedToday,
                      )} earned so far today, ${formatCoins(
                        remainingToday,
                      )} still to go. The limit resets at midnight.`}
                </AppText>
              </VStack>
            </HStack>
          </Box>

          <HStack align="start" gap="md" px="xs">
            <Icon as={ShieldCheck} size="lg" tint={colors.success} />
            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong">
                Step coins are checked first
              </AppText>
              <AppText variant="caption" color="textSecondary">
                {pending > 0
                  ? `${formatCoins(
                      pending,
                    )} coins from your steps are being verified and will be added once they clear — usually within a day or two.`
                  : 'Coins from steps show as pending until they are verified, usually within a day or two, then join your balance.'}
              </AppText>
            </VStack>
          </HStack>

          <VStack gap="sm" pt="xs">
            <Button
              label="Spend in the shop"
              variant="brand"
              fullWidth
              onPress={onPressShop}
            />
            <Button
              label="Got it"
              variant="ghost"
              fullWidth
              onPress={onClose}
            />
          </VStack>
        </VStack>
      </BottomSheet>
    );
  },
);

CoinsInfoSheet.displayName = 'CoinsInfoSheet';
