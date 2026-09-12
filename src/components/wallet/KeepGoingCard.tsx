import React, { memo } from 'react';
import { ArrowRight, Footprints, Plus } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { CoinBadge } from './CoinBadge';

interface Props {
  title?: string;
  message?: string;
}

/**
 * The nudge between the wallet's shortcuts and its ledger.
 *
 * Deliberately not pressable and deliberately green rather than the brand
 * orange: it is the one block on the screen that asks for nothing. Everything
 * above it is a place to spend or inspect coins, so a user who has just seen a
 * balance they cannot do much with gets a reason to come back tomorrow instead
 * of a fifth button.
 */
export const KeepGoingCard = memo(
  ({
    title = 'Keep Going!',
    message = 'Your effort today builds your rewards for tomorrow.',
  }: Props) => {
    const { colors, isDark } = useTheme();

    return (
      <Card
        radius="lg"
        padding="md"
        style={{
          backgroundColor: withAlpha(colors.success, isDark ? 0.12 : 0.1),
        }}
      >
        <HStack align="center" gap="md">
          <CoinBadge tint={colors.success} size={40} halo />

          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong" color="success">
              {title}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              {message}
            </AppText>
          </VStack>

          {/*
            Decorative: it restates "walk, and coins follow" as a picture, which
            the sentence beside it already says in words. Hidden from the
            screen reader so it is not announced as four unnamed glyphs.
          */}
          <HStack
            align="center"
            gap="xxs"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Icon as={ArrowRight} size="xs" color="textTertiary" />
            <Icon as={Footprints} size="sm" color="textSecondary" />
            <Icon as={Plus} size="xs" color="textTertiary" />
            <Icon as={Plus} size="xs" color="textTertiary" />
          </HStack>
        </HStack>
      </Card>
    );
  },
);

KeepGoingCard.displayName = 'KeepGoingCard';
