import React, { memo, useCallback } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { Minus, Plus, Trash2 } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  value: number;
  /** The most the till allows in one line (⚙ `commerce.maxQuantityPerLine`). */
  max: number;
  onChange: (quantity: number) => void;
  /** A write is in flight: the figure holds and the buttons wait. */
  busy?: boolean;
  /** At one, the minus becomes a bin — the line is removed rather than zeroed. */
  removable?: boolean;
  /** Read out with the buttons: "of Yoga Mat". */
  label?: string;
}

/**
 * Minus, the count, plus. On a cart line the minus at one is a bin, so
 * removing a line is one tap and looks like one; on a product page the
 * count stops at one, because there the question is only how many.
 */
export const QuantityStepper = memo(
  ({
    value,
    max,
    onChange,
    busy = false,
    removable = false,
    label = '',
  }: Props) => {
    const { colors } = useTheme();
    const atMin = value <= 1 && !removable;
    const atMax = value >= max;
    const decrement = useCallback(() => onChange(value - 1), [onChange, value]);
    const increment = useCallback(() => onChange(value + 1), [onChange, value]);

    return (
      <HStack
        align="center"
        style={[
          styles.frame,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <Pressable
          onPress={decrement}
          disabled={busy || atMin}
          feedback="opacity"
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={
            value <= 1 && removable
              ? `Remove ${label}`.trim()
              : `One fewer ${label}`.trim()
          }
          accessibilityState={{ disabled: busy || atMin }}
        >
          <Icon
            as={value <= 1 && removable ? Trash2 : Minus}
            size="sm"
            tint={
              atMin
                ? colors.textQuaternary
                : value <= 1 && removable
                ? colors.destructive
                : colors.text
            }
          />
        </Pressable>
        <HStack align="center" justify="center" style={styles.count}>
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <AppText
              variant="bodyStrong"
              accessibilityLabel={`Quantity ${value}`}
            >
              {value}
            </AppText>
          )}
        </HStack>
        <Pressable
          onPress={increment}
          disabled={busy || atMax}
          feedback="opacity"
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={`One more ${label}`.trim()}
          accessibilityState={{ disabled: busy || atMax }}
        >
          <Icon
            as={Plus}
            size="sm"
            tint={atMax ? colors.textQuaternary : colors.text}
          />
        </Pressable>
      </HStack>
    );
  },
);

QuantityStepper.displayName = 'QuantityStepper';

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  button: {
    width: 40,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { minWidth: 36, height: 36 },
});
