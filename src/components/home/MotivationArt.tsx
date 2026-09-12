import React, { memo } from 'react';
import { Emoji } from '../media/Emoji';
import { HStack } from '../layout/Stack';

/** The default trio: the run, the climb, the day it happens on. */
export const MOTIVATION_EMOJIS = ['🏃', '🏔️', '☀️'] as const;

interface Props {
  /** Overrides the trio — a seasonal set, or one tied to the day's quote. */
  emojis?: readonly string[];
  size?: 'md' | 'lg';
}

/**
 * The row of emoji that closes the motivation card.
 *
 * Emoji rather than an illustration asset: they ship no bytes, render at every
 * density, and already carry the warmth the card is there to add. The row is
 * decorative — no `label` is passed down — because the quote beside it is the
 * content, and three announced glyphs would only delay reaching it.
 */
export const MotivationArt = memo(
  ({ emojis = MOTIVATION_EMOJIS, size = 'md' }: Props) => (
    <HStack align="center" gap="base">
      {emojis.map(emoji => (
        <Emoji key={emoji} size={size}>
          {emoji}
        </Emoji>
      ))}
    </HStack>
  ),
);

MotivationArt.displayName = 'MotivationArt';
