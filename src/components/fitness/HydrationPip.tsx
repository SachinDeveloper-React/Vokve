import React, { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { Box } from '../layout/Box';

interface Props {
  /** Whether this glass has been drunk yet. */
  filled: boolean;
}

/**
 * The frame, and the mark inside it at exactly half.
 *
 * Fixed here rather than left to taste because ten frames and their gaps have
 * to sit on one line beside the droplet on a 320pt phone, where the whole row
 * gets about 205pt. At 20pt the row measured 252pt and the last glasses wrapped
 * onto a second line by themselves; 18pt brings it to 200pt and it fits at
 * every width the app runs at.
 */
const FRAME = moderateScale(10);
/** Scaled in its own right, not FRAME/2: halving an already pixel-rounded
    value lands between device pixels and softens the mark's edges. */
const MARK = moderateScale(5);
/** A hairline vanishes at this size, so the outline is drawn deliberately. */
const STROKE = moderateScale(1.5);

/**
 * One glass in the intake row: a frame with a mark inside it, the mark solid
 * once the glass has been drunk.
 *
 * The frame is drawn whether or not the glass is filled, which is what keeps
 * the row countable — every position takes the same width, so the marks land
 * on one pitch and the empty slots read as slots rather than as a gap.
 *
 * Size, stroke and the theme's border colour are the three things `Box` has no
 * token for, so those — and nothing else — come from the stylesheet.
 */
export const HydrationPip = memo(({ filled }: Props) => {
  const { colors } = useTheme();

  const outline = useMemo(
    () => ({ borderWidth: STROKE, borderColor: colors.textQuaternary }),
    [colors],
  );

  return (
    <Box style={[styles.frame, outline]}>
      <Box
        bg={filled ? 'primary' : undefined}
        style={[styles.mark, filled ? null : outline]}
      />
    </Box>
  );
});

const styles = StyleSheet.create({
  frame: {
    width: FRAME,
    height: FRAME,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: { width: MARK, height: MARK },
});

HydrationPip.displayName = 'HydrationPip';
