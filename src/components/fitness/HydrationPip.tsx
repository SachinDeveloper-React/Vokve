import React, { memo } from 'react';
import { moderateScale } from '../../theme/responsive';
import { WaterGlass } from '../hydration/WaterGlass';

interface Props {
  /** 0–1: how much of this glass has been drunk. */
  fill: number;
}

/**
 * The height one glass is drawn at in the intake row.
 *
 * 15pt tall is 10pt wide at the glass's 64 × 96 proportions — the same
 * footprint the square frame here used to take, so ten of them and their `xs`
 * gaps still measure the 136pt that fits beside the card's own glass on the
 * narrowest phone the app runs at. Picked from the width budget backwards,
 * in other words, not from how a glass looks on its own.
 */
const GLASS_HEIGHT = moderateScale(15);

/**
 * One glass in the intake row, drawn as a glass.
 *
 * It was a square frame with a dot in it, which counted correctly and looked
 * like a checklist: the row said how many were done without saying what was
 * being done. The same glass the water screen fills, drawn small, says both —
 * and a part-drunk glass can then show as part full, which a dot cannot.
 *
 * Empty ones are still drawn rather than omitted, for the reason they always
 * were: the row has to show what is left, not only what is done, and every
 * position taking the same width is what keeps it countable.
 */
export const HydrationPip = memo(({ fill }: Props) => (
  <WaterGlass progress={fill} size={GLASS_HEIGHT} />
));

HydrationPip.displayName = 'HydrationPip';
