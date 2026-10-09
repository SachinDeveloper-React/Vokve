import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronLeft, Share2, Users } from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import type { ChallengeCadence } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { formatCompactNumber } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

const CADENCE_LABEL: Record<ChallengeCadence, string> = {
  daily: 'Daily Challenge',
  weekly: 'Weekly Challenge',
  monthly: 'Monthly Challenge',
};

interface Props {
  title: string;
  description: string;
  cadence: ChallengeCadence;
  /** "15 – 21 Sep 2026" — the period the screen is showing. */
  range: string;
  /** Everyone is enrolled (RULES C5), so this is the membership. */
  joined: number;
  onPressBack: () => void;
  onPressShare: () => void;
}

/**
 * The detail screen's hero: what this challenge is, over what days, with how
 * many people.
 *
 * A dark panel in both themes, like the shop's coin banner and the profile
 * summary, and drawn from the dark palette for the same reason: light mode's
 * own foreground would be invisible on it. It bleeds through the screen's
 * gutter so it reaches the edges of the phone — this is the page's lid, not a
 * card on it.
 *
 * The cadence is a pill rather than a line of the title because it is the one
 * fact that decides what everything below means: "Day 3 of 7" and a daily
 * share of the goal only make sense once the reader knows this resets weekly.
 */
export const ChallengeDetailHero = memo(
  ({
    title,
    description,
    cadence,
    range,
    joined,
    onPressBack,
    onPressShare,
  }: Props) => {
    const { colors } = useTheme();
    const foreground = darkColors.tierForeground;
    const secondary = withAlpha(foreground, 0.7);

    return (
        <VStack gap="base" pt="md" pb="lg">
          <HStack align="center" justify="between" gap="md">
            <Pressable
              onPress={onPressBack}
              feedback="opacity"
              visualSize={24}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Icon as={ChevronLeft} size="lg" tint={foreground} />
            </Pressable>

            <AppText
              variant="h2"
              numberOfLines={1}
              style={{ color: foreground }}
            >
              Challenge Detail
            </AppText>

            <Pressable
              onPress={onPressShare}
              feedback="opacity"
              visualSize={24}
              accessibilityRole="button"
              accessibilityLabel="Share this challenge"
            >
              <Icon as={Share2} size="md" tint={foreground} />
            </Pressable>
          </HStack>

          <VStack gap="sm">
            <VStack
              px="md"
              py="xs"
              style={[styles.pill, { backgroundColor: colors.brandAccent }]}
            >
              <AppText
                variant="labelMicro"
                style={[styles.pillText, { color: darkColors.tierForeground }]}
              >
                {CADENCE_LABEL[cadence]}
              </AppText>
            </VStack>

            <AppText variant="display" style={{ color: foreground }}>
              {title}
            </AppText>

            {description ? (
              <AppText variant="caption" style={{ color: secondary }}>
                {description}
              </AppText>
            ) : null}

            <HStack align="center" gap="md" wrap>
              <AppText variant="micro" style={{ color: secondary }}>
                {range}
              </AppText>

              <HStack
                align="center"
                gap="xs"
                accessible
                accessibilityLabel={`${joined} members taking part`}
              >
                <Icon as={Users} size="xs" tint={secondary} />
                <AppText variant="micro" style={{ color: secondary }}>
                  {`${formatCompactNumber(joined)} joined`}
                </AppText>
              </HStack>
            </HStack>
          </VStack>
        </VStack>
    );
  },
);

ChallengeDetailHero.displayName = 'ChallengeDetailHero';

const styles = StyleSheet.create({
  /** Bleeds through the screen's gutter so the lid reaches both edges. */
  panel: {
    marginHorizontal: -spacing.base,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    overflow: 'hidden',
  },
  pill: { alignSelf: 'flex-start', borderRadius: radius.pill },
  pillText: { letterSpacing: 1 },
});
