import React, { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { moderateScale } from '../../theme/responsive';
import { AppText } from '../ui/AppText';
import { Box } from '../layout/Box';
import { BAR_MAX, PLOT_HEIGHT } from './StepBarColumn';

interface Props {
  /** The value a full-height bar stands for. */
  max: number;
  /** How many labels to draw, the baseline zero included. */
  ticks: number;
}

/** The line box one `micro` label occupies, taken from the type scale. */
const LABEL_HEIGHT = moderateScale(15);
/**
 * A `micro` character's advance, rounded up from its 11pt tabular digits.
 *
 * Over-estimated on purpose: the column is sized from it, and a column half a
 * character too narrow clips the label Android will not let overflow, while
 * one half a character too wide costs the seven bars a point each.
 */
const CHAR_WIDTH = moderateScale(7);
/** Between the longest label and the first bar. */
const LABEL_GAP = moderateScale(6);

/**
 * A tick as the scale reads it: `12000` is `12k`, `1200` is `1.2k`, `800`
 * stays `800`.
 *
 * Whole thousands lose the `.0` that `formatCompactNumber` would print, which
 * is the whole point of a tick: `4k` is read at a glance where `4.0k` is read
 * as a measurement. Below a thousand there is nothing to shorten.
 */
function tickLabel(value: number): string {
  if (value < 1000) return String(value);
  return `${Number((value / 1000).toFixed(1))}k`;
}

/**
 * The scale down the left of the week chart.
 *
 * Each label is placed where a bar of that value would end, rather than
 * spread evenly down a column: `space-between` would line up the labels'
 * edges, and a label has to line up with a bar's tip or it is pointing at the
 * wrong number. So the box runs the height of the plot plus half a line, and
 * every label hangs from `bottom` at its own share of `BAR_MAX` — the same
 * arithmetic `StepBarColumn` draws the bar with, which is what keeps the two
 * in step when the scale moves.
 *
 * The extra half-line at the foot is what the zero label sits in. Without it
 * that label would be centred on the baseline and so half outside the box,
 * which Android clips.
 *
 * No line and no gridlines: the bars already stand on a common baseline, and
 * the ask was for something to read the heights against, not a frame around
 * them. Hidden from screen readers because each bar already speaks its own
 * count (`StepBarColumn`), and a reader that announced the scale as well
 * would read seven numbers twice.
 */
export const StepAxis = memo(({ max, ticks }: Props) => {
  const scale = useMemo(() => {
    const labels = Array.from({ length: ticks }, (_, index) => {
      const value = Math.round((index / Math.max(1, ticks - 1)) * max);
      return { text: tickLabel(value), bottom: (value / Math.max(1, max)) * BAR_MAX };
    });
    // Sized from the longest label rather than fixed, so `0 / 300 / 600 / 900`
    // takes no more room from the bars than it needs and `12.5k` still fits.
    const width = labels.reduce((w, l) => Math.max(w, l.text.length), 0) * CHAR_WIDTH + LABEL_GAP;
    return { labels, width };
  }, [max, ticks]);

  return (
    <Box
      style={[styles.axis, { height: PLOT_HEIGHT + LABEL_HEIGHT / 2, width: scale.width }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {scale.labels.map((label, index) => (
        <AppText
          key={index}
          variant="micro"
          color="textTertiary"
          numberOfLines={1}
          style={[styles.tick, { bottom: label.bottom }]}
        >
          {label.text}
        </AppText>
      ))}
    </Box>
  );
});

StepAxis.displayName = 'StepAxis';

const styles = StyleSheet.create({
  /**
   * Top-aligned against a row that hangs its columns from the bottom: the
   * plot box is the first thing in every column, so matching the tops is what
   * puts this scale beside the bars rather than beside the weekday labels.
   *
   * The width is measured from the longest label rather than left to the
   * text itself: an absolutely positioned child adds nothing to its parent's
   * width, so the box would collapse and the labels would hang outside it.
   */
  axis: { alignSelf: 'flex-start' },
  tick: { position: 'absolute', right: LABEL_GAP, textAlign: 'right' },
});
