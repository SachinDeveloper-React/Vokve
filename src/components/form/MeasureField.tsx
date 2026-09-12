import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, TextInput, TextInputProps } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { Box } from '../layout/Box';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';
import { FormControl, type FormControlProps } from './FormControl';
import { INPUT_MIN_HEIGHT, inputTextStyle } from './Input';
import { Pressable } from './Pressable';

interface Props
  extends Omit<
      TextInputProps,
      | 'style'
      | 'editable'
      | 'value'
      | 'onChange'
      | 'onChangeText'
      | 'keyboardType'
    >,
    Omit<FormControlProps, 'children'> {
  /** The figure, in whatever `unit` currently reads. Null while unanswered. */
  value: number | null;
  onChange: (value: number | null) => void;
  /** What the chip inside the field shows: `cm`, `kg`. */
  unit: string;
  /** Called when the unit chip is tapped. Omit to make the unit fixed. */
  onUnitPress?: () => void;
  leading?: React.ReactNode;
  disabled?: boolean;
}

/**
 * A number with its unit attached — a height, a weight, a distance.
 *
 * The unit is a chip inside the field rather than a separate control beside
 * it, because a figure and its unit are one answer: `68` on its own is not a
 * weight, and a layout that lets them drift apart invites reading the number
 * under the wrong one.
 *
 * Tapping the chip cycles the unit rather than opening a menu. These fields
 * have exactly two systems to choose between, and a sheet that covers half the
 * screen to offer two options is slower than the tap it replaces — the chevron
 * is there to say the chip is tappable at all.
 */
export function MeasureField({
  value,
  onChange,
  unit,
  onUnitPress,
  leading,
  disabled = false,
  onFocus,
  onBlur,
  // Pulled out of `rest` rather than left in it: everything remaining is
  // spread onto the TextInput, and `label` or `error` arriving there is an
  // unknown prop on a native view.
  label,
  helper,
  error,
  required,
  ...rest
}: Props) {
  const { colors } = useTheme();
  const [isFocused, setFocused] = useState(false);

  const handleFocus = useCallback<NonNullable<TextInputProps['onFocus']>>(
    event => {
      setFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );

  const handleBlur = useCallback<NonNullable<TextInputProps['onBlur']>>(
    event => {
      setFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  const handleText = useCallback(
    (next: string) => {
      // One decimal place, digits only. A height is never negative and never
      // needs three decimals, and letting `e` or `-` through produces a NaN
      // that surfaces three screens later as a blank chart.
      const cleaned = next.replace(/[^\d.]/g, '');
      const [whole, ...fraction] = cleaned.split('.');
      const normalised = fraction.length
        ? `${whole}.${fraction.join('').slice(0, 1)}`
        : whole;

      if (normalised === '' || normalised === '.') {
        onChange(null);
        return;
      }

      const parsed = Number(normalised);
      onChange(Number.isFinite(parsed) ? parsed : null);
    },
    [onChange],
  );

  // Kept as a string derived from the number, but *not* re-rendered mid-typing
  // into something the user did not type: `68.` has to survive long enough for
  // the next digit to arrive.
  const text = useMemo(() => (value === null ? '' : String(value)), [value]);

  const borderColor = error
    ? colors.destructive
    : isFocused
    ? colors.primary
    : colors.input;

  return (
    <FormControl
      label={label}
      helper={helper}
      error={error}
      required={required}
      disabled={disabled}
    >
      <Box
        style={[
          styles.field,
          error || isFocused ? styles.fieldActive : styles.fieldRest,
          { backgroundColor: colors.inputBackground, borderColor },
        ]}
      >
        <HStack align="center" gap="sm">
          {leading}

          <TextInput
            style={[styles.input, { color: colors.text }]}
            value={text}
            onChangeText={handleText}
            placeholderTextColor={colors.textTertiary}
            editable={!disabled}
            onFocus={handleFocus}
            onBlur={handleBlur}
            keyboardType="decimal-pad"
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            {...rest}
          />

          {onUnitPress ? (
            <Pressable
              onPress={onUnitPress}
              disabled={disabled}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel={`Unit: ${unit}`}
              accessibilityHint="Switches between metric and imperial"
            >
              <HStack align="center" gap="xxs">
                <AppText variant="bodyStrong">{unit}</AppText>
                <Icon as={ChevronDown} size="sm" color="textTertiary" />
              </HStack>
            </Pressable>
          ) : (
            <AppText variant="bodyStrong" color="textSecondary">
              {unit}
            </AppText>
          )}
        </HStack>
      </Box>
    </FormControl>
  );
}

const styles = StyleSheet.create({
  field: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    minHeight: INPUT_MIN_HEIGHT,
    justifyContent: 'center',
  },
  fieldRest: { borderWidth: StyleSheet.hairlineWidth },
  fieldActive: { borderWidth: 1 },
  input: {
    ...inputTextStyle,
    flex: 1,
    // Android adds its own vertical padding that misaligns the text.
    paddingVertical: 0,
  },
});
