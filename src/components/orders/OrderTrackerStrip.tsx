import React, { Fragment, memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { OrderStatus } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

export type TrackerSize = 'sm' | 'md';

const DOT: Record<TrackerSize, number> = {
  sm: moderateScale(20),
  md: moderateScale(28),
};

/**
 * The four stops a member is shown, and the state each one stands for
 * (RULES R5). "Packed" is what `confirmed` means to someone waiting for a
 * parcel — the warehouse word, not ours. The short label is for the strip
 * on a list card, where four cells share the width of a phone.
 */
const STOPS: readonly {
  status: OrderStatus;
  label: string;
  short: string;
}[] = [
  { status: 'placed', label: 'Order\nPlaced', short: 'Placed' },
  { status: 'confirmed', label: 'Packed', short: 'Packed' },
  { status: 'shipped', label: 'Shipped', short: 'Shipped' },
  { status: 'delivered', label: 'Delivered', short: 'Delivered' },
];

interface Props {
  status: OrderStatus;
  /** `sm` is the strip under a list row; `md` the one on the order page. */
  size?: TrackerSize;
}

const makeStyles = ({ colors, radius }: ThemeShape) =>
  StyleSheet.create({
    dot: {
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    line: { flex: 1, height: 2, borderRadius: radius.pill },
    cell: { flex: 1 },
    label: { lineHeight: 14 },
    // The end labels sit under their own dot rather than centred in a cell,
    // which would push them away from the stop they name.
    start: { textAlign: 'left' },
    middle: { textAlign: 'center' },
    end: { textAlign: 'right' },
  });

/**
 * How far along the order is, as the four stops it passes on the way to
 * the door. Everything up to and including where it stands now is filled
 * in the brand orange and ticked; the rest are empty rings.
 *
 * An order that has not been paid for has reached none of them, and one
 * that was cancelled or refunded has stepped off the path — neither draws
 * this, because a half-lit track would suggest it is still coming.
 */
export const OrderTrackerStrip = memo(({ status, size = 'md' }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const reached = STOPS.findIndex(stop => stop.status === status);
  const diameter = DOT[size];

  return (
    <VStack gap={size === 'sm' ? 'xs' : 'sm'}>
      <HStack align="center">
        {STOPS.map((stop, index) => {
          const done = index <= reached;
          return (
            <Fragment key={stop.status}>
              {index > 0 ? (
                <View
                  style={[
                    styles.line,
                    {
                      backgroundColor: done ? colors.brandAccent : colors.border,
                    },
                  ]}
                />
              ) : null}
              <View
                style={[
                  styles.dot,
                  {
                    width: diameter,
                    height: diameter,
                    borderRadius: diameter / 2,
                  },
                  done && {
                    backgroundColor: colors.brandAccent,
                    borderColor: colors.brandAccent,
                  },
                ]}
              >
                {done ? (
                  <Icon
                    as={Check}
                    size={moderateScale(size === 'sm' ? 11 : 14)}
                    tint={colors.primaryForeground}
                  />
                ) : null}
              </View>
            </Fragment>
          );
        })}
      </HStack>

      <HStack align="start">
        {STOPS.map((stop, index) => (
          <AppText
            key={stop.status}
            variant={size === 'sm' ? 'miniMicro' : 'micro'}
            color={index <= reached ? undefined : 'textTertiary'}
            style={[
              styles.cell,
              styles.label,
              index <= reached && { color: colors.brandAccent },
              index === 0
                ? styles.start
                : index === STOPS.length - 1
                ? styles.end
                : styles.middle,
            ]}
          >
            {size === 'sm' ? stop.short : stop.label}
          </AppText>
        ))}
      </HStack>
    </VStack>
  );
});

OrderTrackerStrip.displayName = 'OrderTrackerStrip';
