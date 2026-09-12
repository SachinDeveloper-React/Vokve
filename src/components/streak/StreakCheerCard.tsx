import React, { memo } from 'react';
import { Trophy } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

interface Props {
  /** Null while the profile is loading — the line drops the name. */
  name?: string | null;
  currentStreak: number;
}

/** First name only — a cheer with a full legal name reads like a form. */
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * The line at the foot of the streak screen.
 *
 * Deliberately not pressable and deliberately last: everything above it is a
 * figure, a calendar or a tool, and a user who has just scrolled through all
 * of that gets a sentence addressed to them instead of a fifth control.
 */
export const StreakCheerCard = memo(({ name, currentStreak }: Props) => {
  const { colors } = useTheme();
  const who = name ? `, ${firstNameOf(name)}` : '';

  const title =
    currentStreak > 0
      ? `You're doing amazing${who}! 💪`
      : `Today's a good day to start${who}! 💪`;
  const message =
    currentStreak > 0
      ? 'Stay consistent today and keep your streak alive!'
      : 'One workout today and the streak begins.';

  return (
    <Card radius="xl" padding="base">
      <HStack align="center" gap="md">
        <Icon as={Trophy} size="lg" tint={colors.gold} />

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={2}>
            {title}
          </AppText>
          <AppText variant="micro" color="textSecondary" numberOfLines={2}>
            {message}
          </AppText>
        </VStack>

        {/*
          Decorative: it restates "move, and the streak follows" as a picture,
          which the sentence beside it already says. Hidden from the screen
          reader so it is not announced as unnamed glyphs.
        */}
        <HStack
          align="center"
          gap="xs"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Emoji size="md">👟</Emoji>
          <AppText variant="bodyStrong" color="textTertiary">
            + +
          </AppText>
        </HStack>
      </HStack>
    </Card>
  );
});

StreakCheerCard.displayName = 'StreakCheerCard';
