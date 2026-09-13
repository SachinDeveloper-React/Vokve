import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

interface Props {
  /** The card's subject — "Top Achievement", "Streak". */
  label: string;
  /** The line under it, in the card's colour — "Best Day This Week". */
  headline: string;
  /** The figure the card is about — "14,231 steps", "7 Days". */
  value: string;
  /** What to do about it — "Keep it up! 3 more days". */
  caption: string;
  /** Colours the headline. Pass a theme colour. */
  tint: string;
  /** Draws the figure in the tint instead of the headline. */
  tintValue?: boolean;
}

/**
 * One of the two cards under the chart: a label, a line, a figure and a nudge.
 *
 * Both are the same component because they are the same shape of statement —
 * "here is a number worth knowing, and here is what it means" — and building
 * them separately would let the pair drift apart by a few points of padding
 * the moment either was touched.
 */
export const AnalyticsHighlightCard = memo(
  ({ label, headline, value, caption, tint, tintValue = false }: Props) => (
    <Card radius="xl" padding="base" style={styles.card}>
      <VStack gap="xs">
        <AppText variant="label" color="textSecondary" numberOfLines={1}>
          {label}
        </AppText>

        <AppText
          variant="micro"
          numberOfLines={1}
          style={tintValue ? undefined : { color: tint }}
          color={tintValue ? 'textSecondary' : undefined}
        >
          {headline}
        </AppText>

        <AppText
          variant="h2"
          numberOfLines={1}
          style={tintValue ? { color: tint } : undefined}
        >
          {value}
        </AppText>

        <AppText variant="miniMicro" color="textTertiary" numberOfLines={2}>
          {caption}
        </AppText>
      </VStack>
    </Card>
  ),
);

AnalyticsHighlightCard.displayName = 'AnalyticsHighlightCard';

/** The pair share the row, so each takes half of it however long its copy. */
const styles = StyleSheet.create({
  card: { flex: 1 },
});
