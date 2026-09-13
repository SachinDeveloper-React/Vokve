import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Heart, Info } from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Band {
  label: string;
  tint: 'success' | 'warning' | 'destructive';
}

/**
 * What a score means, in a word.
 *
 * Derived from the figure rather than stored beside it: the two are the same
 * fact, and a card that said "82 — Needs work" would be worse than saying
 * nothing at all.
 */
function bandFor(score: number, outOf: number): Band {
  const percent = (score / Math.max(1, outOf)) * 100;
  if (percent >= 80) return { label: 'Good', tint: 'success' };
  if (percent >= 60) return { label: 'Fair', tint: 'warning' };
  return { label: 'Needs work', tint: 'destructive' };
}

/** First name only — a cheer with a full legal name reads like a form. */
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

interface Props {
  score: number;
  outOf: number;
  /** Null while the profile is loading — the line drops the name. */
  name?: string | null;
  onPressInfo: () => void;
}

/**
 * The screen's headline: one number for how the user is doing.
 *
 * The number and the sentence beside it are deliberately paired. A score out of
 * a hundred with nothing next to it invites the reader to compare themselves
 * with a stranger; the line turns it back into something about them.
 *
 * The ⓘ is wired rather than decorative: a health score the user did not
 * choose the rules for has to be able to explain itself.
 */
export const HealthScoreCard = memo(
  ({ score, outOf, name, onPressInfo }: Props) => {
    const { colors } = useTheme();
    const foreground = darkColors.tierForeground;
    const secondary = withAlpha(foreground, 0.68);
    const band = bandFor(score, outOf);
    const who = name ? `, ${firstNameOf(name)}` : '';

    return (
      <View style={[styles.panel, { backgroundColor: colors.tierBackground }]}>
        <HStack align="center" gap="base">
          <Icon as={Heart} size="xl" tint={foreground} />

          <VStack gap="xxs">
            <Pressable
              onPress={onPressInfo}
              feedback="opacity"
              visualSize={20}
              accessibilityRole="button"
              accessibilityLabel="Health score, what is this?"
            >
              <HStack align="center" gap="xs">
                <AppText variant="micro" style={{ color: secondary }}>
                  Health Score
                </AppText>
                <Icon as={Info} size="xs" tint={secondary} />
              </HStack>
            </Pressable>

            <HStack align="baseline" gap="xxs">
              <AppText variant="metric" style={{ color: foreground }}>
                {score}
              </AppText>
              <AppText variant="body" style={{ color: secondary }}>
                {`/${outOf}`}
              </AppText>
            </HStack>

            <AppText variant="bodyStrong" style={{ color: darkColors[band.tint] }}>
              {band.label}
            </AppText>
          </VStack>

          <VStack flex={1} gap="xs">
            <AppText
              variant="bodyStrong"
              numberOfLines={1}
              style={{ color: foreground }}
            >
              {`Great job${who}! 💪`}
            </AppText>
            <AppText variant="micro" style={{ color: secondary }}>
              You're doing great. Keep going and stay healthy!
            </AppText>
          </VStack>
        </HStack>
      </View>
    );
  },
);

HealthScoreCard.displayName = 'HealthScoreCard';

const styles = StyleSheet.create({
  panel: { borderRadius: radius.xl, padding: spacing.base },
});
