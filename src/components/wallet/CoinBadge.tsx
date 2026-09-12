import React, { memo } from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { Star } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { HStack } from '../layout/Stack';
import { IconBadge } from '../ui/IconBadge';

/** The inner coin's share of the halo, taken from the design's 26-in-40. */
const INNER_RATIO = 0.65;

interface Props {
  /** The coin's colour — gold for a balance, green for an encouragement. */
  tint: string;
  /** Outer diameter at the 375pt baseline. Scaled per device from there. */
  size?: number;
  /**
   * Wraps the coin in a faint ring of its own colour. Used where the badge has
   * to hold its own against a tinted card behind it — a solid disc alone
   * disappears into a wash of the same hue.
   */
  halo?: boolean;
}

/**
 * The app's coin mark: a filled disc with a star struck into it.
 *
 * Distinct from `CoinAmount`, which is a coin figure with a number. This is
 * the coin as an emblem — the thing the wallet's headline sits next to and the
 * encouragement card leads with — so the two never have to be assembled by
 * hand at different sizes on each screen.
 */
export const CoinBadge = memo(({ tint, size = 42, halo = false }: Props) => {
  const { isDark } = useTheme();

  if (!halo) {
    return <IconBadge icon={Star} tint={tint} size={size} variant="solid" />;
  }

  const box = moderateScale(size);

  return (
    <HStack
      align="center"
      justify="center"
      radius="pill"
      style={[
        styles.halo,
        { width: box, height: box, backgroundColor: withAlpha(tint, isDark ? 0.22 : 0.14) },
      ]}
    >
      <IconBadge
        icon={Star}
        tint={tint}
        size={Math.round(size * INNER_RATIO)}
        variant="solid"
      />
    </HStack>
  );
});

CoinBadge.displayName = 'CoinBadge';

/**
 * The one thing the primitives cannot express: a fixed diameter. Spacing and
 * radius are tokens, but a badge's size is a measurement the design gives.
 */
const styles = StyleSheet.create<{ halo: ViewStyle }>({
  halo: { flexGrow: 0, flexShrink: 0 },
});
