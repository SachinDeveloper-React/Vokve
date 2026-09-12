import React, { memo, useCallback } from 'react';
import { moderateScale } from '../../theme/responsive';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';
import { HydrationPip } from './HydrationPip';

interface Props {
  /** Amount this control logs, in millilitres. */
  ml: number;
  onPress: (ml: number) => void;
}

/** Roughly the height of the label, for the hit-slop floor. */
const VISUAL_SIZE = moderateScale(20);

/**
 * One quick-add amount: just how much it pours.
 *
 * Deliberately borderless and unillustrated. These two sit inside a card that
 * already has an edge, and boxing them draws a second frame inside the first;
 * a glass icon in front of each repeated, twice, what the droplet and the
 * "Hydration" label have already established. The accent colour is enough to
 * say the amounts can be tapped.
 *
 * What dropping the frame and the icon loses is target size, which is why the
 * press area is grown back out to the 44pt floor through `visualSize` rather
 * than left at the size of the text.
 */
export const HydrationQuickAdd = memo(({ ml, onPress }: Props) => {
  const handlePress = useCallback(() => onPress(ml), [ml, onPress]);

  return (
    <Pressable
      onPress={handlePress}
      feedback="scale"
      visualSize={VISUAL_SIZE}
      accessibilityRole="button"
      accessibilityLabel={`Add ${ml} millilitres`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: moderateScale(4),
      }}
    >
      <HydrationPip filled={true} />
      <AppText variant="micro" color="primary">
        {`+${ml} ml`}
      </AppText>
    </Pressable>
  );
});

HydrationQuickAdd.displayName = 'HydrationQuickAdd';
