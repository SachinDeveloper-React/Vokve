import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Heart } from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

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
function bandFor(score: number, outOf: number, word?: string): Band {
  const percent = (score / Math.max(1, outOf)) * 100;
  if (percent >= 80) return { label: word ?? 'Good', tint: 'success' };
  if (percent >= 60) return { label: word ?? 'Fair', tint: 'warning' };
  return { label: word ?? 'Needs work', tint: 'destructive' };
}

/** First name only — a cheer with a full legal name reads like a form. */
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

interface Props {
  score: number;
  outOf: number;
  /** The server's word for the score; the colour still follows the figure. */
  band?: string;
  /** Null while the profile is loading — the line drops the name. */
  name?: string | null;
}

/**
 * The screen's headline: one number for how the user is doing.
 *
 * The number and the sentence beside it are deliberately paired. A score out of
 * a hundred with nothing next to it invites the reader to compare themselves
 * with a stranger; the line turns it back into something about them.
 *
 * The label used to carry an ⓘ to an explainer that was never built. A
 * control that does nothing is worse than no control, so what is left is the
 * label — and the band word beside the figure, which is the server's own
 * reading of it and the nearest thing to an explanation the app has.
 */
export const HealthScoreCard = memo(
  ({ score, outOf, band: word, name }: Props) => {
    const { colors } = useTheme();
    const foreground = darkColors.tierForeground;
    const secondary = withAlpha(foreground, 0.68);
    const band = bandFor(score, outOf, word);
    const who = name ? `, ${firstNameOf(name)}` : '';

    return (
      <View style={[styles.panel, { backgroundColor: colors.tierBackground }]}>
        <HStack align="center" gap="base">
          <Icon as={Heart} size="xl" tint={foreground} />

          <VStack gap="xxs">
            <AppText variant="micro" style={{ color: secondary }}>
              Health Score
            </AppText>

            <HStack align="baseline" gap="xxs">
              <AppText variant="metric" style={{ color: foreground }}>
                {score}
              </AppText>
              <AppText variant="body" style={{ color: secondary }}>
                {`/${outOf}`}
              </AppText>
            </HStack>

            <AppText
              variant="bodyStrong"
              style={{ color: darkColors[band.tint] }}
            >
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
