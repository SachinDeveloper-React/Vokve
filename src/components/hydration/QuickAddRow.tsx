import React, { memo } from 'react';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { QuickAddTile } from './QuickAddTile';

/**
 * The amounts on offer, in the order a glass, a bottle and a large bottle come
 * to hand. `null` is the custom tile, which opens the sheet instead of logging.
 */
const AMOUNTS: readonly { ml: number | null; label: string }[] = [
  { ml: 250, label: '250 ml' },
  { ml: 500, label: '500 ml' },
  { ml: 750, label: '750 ml' },
  { ml: 1000, label: '1 L' },
  { ml: null, label: 'Custom' },
];

interface Props {
  onAdd: (ml: number) => void;
  onPressCustom: () => void;
}

/**
 * The five ways to log a drink.
 *
 * Five across the width rather than a scrolling strip: this is the whole point
 * of the screen, and an amount parked off the right edge is an amount nobody
 * taps. It is what keeps the tiles narrow, which is why each carries a figure
 * and not a sentence.
 */
export const QuickAddRow = memo(({ onAdd, onPressCustom }: Props) => (
  <VStack gap="sm">
    <AppText variant="h3">Quick Add</AppText>

    <HStack align="stretch" gap="sm">
      {AMOUNTS.map(amount => (
        <QuickAddTile
          key={amount.label}
          ml={amount.ml}
          label={amount.label}
          onAdd={onAdd}
          onPressCustom={onPressCustom}
        />
      ))}
    </HStack>
  </VStack>
));

QuickAddRow.displayName = 'QuickAddRow';
