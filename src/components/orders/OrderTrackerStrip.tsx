import React, { Fragment, memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { OrderStatus } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

const DOT = moderateScale(28);

/**
 * The four stops a member is shown, and the state each one stands for
 * (RULES R5). "Packed" is what `confirmed` means to someone waiting for a
 * parcel — the warehouse word, not ours.
 */
const STOPS: readonly { status: OrderStatus; label: string }[] = [
  { status: 'placed', label: 'Order\nPlaced' },
  { status: 'confirmed', label: 'Packed' },
  { status: 'shipped', label: 'Shipped' },
  { status: 'delivered', label: 'Delivered' },
];

interface Props {
  status: OrderStatus;
}

const makeStyles = ({ colors, radius }: ThemeShape) =>
  StyleSheet.create({
    dot: {
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
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
export const OrderTrackerStrip = memo(({ status }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const reached = STOPS.findIndex(stop => stop.status === status);

  return (
    <VStack gap="sm">
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
                  done && {
                    backgroundColor: colors.brandAccent,
                    borderColor: colors.brandAccent,
                  },
                ]}
              >
                {done ? (
                  <Icon
                    as={Check}
                    size={moderateScale(14)}
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
            variant="micro"
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
            {stop.label}
          </AppText>
        ))}
      </HStack>
    </VStack>
  );
});

OrderTrackerStrip.displayName = 'OrderTrackerStrip';
