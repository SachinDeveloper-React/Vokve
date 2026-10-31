import React, { memo } from 'react';
import { HStack } from '../layout/Stack';
import { HydrationPip } from './HydrationPip';

interface Props {
  /**
   * Glasses drunk, and fractional on purpose: `6.4` is six drunk and the
   * seventh two fifths of the way up. The spoken count still rounds down —
   * a glass part way is a glass not yet drunk.
   */
  filled: number;
  total: number;
}

/**
 * The day's intake told a second way: glasses drunk against glasses left.
 *
 * A fraction like "1.6 / 2.5 L" takes a moment to place, whereas six out of
 * nine is immediate — the same fact read by counting instead of by dividing.
 * The empty ones are drawn rather than omitted because the row has to show
 * what is left, not just what is done, and the one being drunk is drawn part
 * full rather than rounded to one side of the truth.
 *
 * The gap is `xs` rather than `sm` because the row's budget is what it is:
 * beside the card's own glass, inside its padding, ten of these get about 205pt
 * on a 320pt phone. At `sm` the row measured 252pt and wrapped, which is worse
 * than tight — a lone tenth glass on a second line reads as a separate thing
 * to count rather than as the end of the first row.
 *
 * `wrap` stays on as a floor, not as the plan: at a large accessibility text
 * size the card grows around this row, and a row that wraps beats one that
 * overflows the card.
 *
 * The label still says "glasses" — that is what is being counted, and it is
 * what a screen reader needs to hear, whatever shape the row is drawn in.
 */
export const HydrationGlasses = memo(({ filled, total }: Props) => (
  <HStack
    align="center"
    gap="xs"
    wrap
    accessibilityRole="text"
    accessibilityLabel={`${Math.floor(filled)} of ${total} glasses`}
  >
    {Array.from({ length: total }, (_, index) => (
      <HydrationPip key={index} fill={Math.min(1, Math.max(0, filled - index))} />
    ))}
  </HStack>
));

HydrationGlasses.displayName = 'HydrationGlasses';
