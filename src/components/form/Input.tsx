import React, { forwardRef, useCallback, useMemo, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { radius, spacing, typography, useTheme } from '../../theme';
import { FormControl, type FormControlProps } from './FormControl';

export interface InputProps
  extends Omit<TextInputProps, 'style' | 'editable'>,
    Omit<FormControlProps, 'children'> {
  /** Rendered inside the field, before the text. */
  leading?: React.ReactNode;
  /** Rendered inside the field, after the text — a clear or reveal button. */
  trailing?: React.ReactNode;
  disabled?: boolean;
  containerStyle?: ViewStyle;
}

/** The smallest field height that stays comfortable to hit one-handed. */
export const INPUT_MIN_HEIGHT = 48;

// `typography.body` is spread without its `lineHeight` on purpose. A TextInput
// draws its glyphs at the *bottom* of the line box, so a 22pt line height under
// a 15pt font pushes the text several points below the icons sitting beside it,
// and Android's `includeFontPadding` adds the same drop from the other end. A
// single-line field takes its height from the row, so the line height is not
// doing any work there anyway.
const { lineHeight: bodyLineHeight, ...bodyText } = typography.body;

/**
 * The text style every field's value shares — the plain input, the phone
 * number, anything else drawn inside a bordered row. Exported so those fields
 * stay aligned with each other rather than each re-deriving it.
 */
export const inputTextStyle: TextStyle = {
  ...bodyText,
  includeFontPadding: false,
  textAlignVertical: 'center',
};

/**
 * A single-line text field with label, helper and error states.
 *
 * The border colour carries focus and error state, but never alone: the error
 * text under the field is what actually communicates the problem. Colour-only
 * error signalling is invisible to a colour-blind user.
 */
// RN 0.87 types a TextInput ref as `_TextInputInstance`, not `TextInput`.
type TextInputRef = React.ComponentRef<typeof TextInput>;

export const Input = forwardRef<TextInputRef, InputProps>(
  (
    {
      label,
      helper,
      error,
      required,
      disabled = false,
      leading,
      trailing,
      containerStyle,
      multiline,
      onFocus,
      onBlur,
      ...rest
    },
    ref,
  ) => {
    const { colors } = useTheme();
    const [isFocused, setIsFocused] = useState(false);

    const handleFocus = useCallback<NonNullable<TextInputProps['onFocus']>>(
      event => {
        setIsFocused(true);
        onFocus?.(event);
      },
      [onFocus],
    );

    const handleBlur = useCallback<NonNullable<TextInputProps['onBlur']>>(
      event => {
        setIsFocused(false);
        onBlur?.(event);
      },
      [onBlur],
    );

    const borderColor = useMemo(() => {
      if (error) return colors.destructive;
      if (isFocused) return colors.primary;
      return colors.input;
    }, [error, isFocused, colors]);

    return (
      <FormControl
        label={label}
        helper={helper}
        error={error}
        required={required}
        disabled={disabled}
      >
        <View
          style={[
            styles.field,
            error || isFocused ? styles.fieldActive : styles.fieldRest,
            { backgroundColor: colors.inputBackground, borderColor },
            containerStyle,
          ]}
        >
          {leading ? <View style={styles.adornment}>{leading}</View> : null}
          <TextInput
            ref={ref}
            style={[
              styles.input,
              multiline && styles.inputMultiline,
              { color: colors.text },
            ]}
            multiline={multiline}
            placeholderTextColor={colors.textTertiary}
            editable={!disabled}
            onFocus={handleFocus}
            onBlur={handleBlur}
            accessibilityLabel={label}
            // Announces the invalid state to screen readers, which the border
            // colour on its own does not.
            accessibilityState={{ disabled }}
            {...rest}
          />
          {trailing ? <View style={styles.adornment}>{trailing}</View> : null}
        </View>
      </FormControl>
    );
  },
);

Input.displayName = 'Input';

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    minHeight: INPUT_MIN_HEIGHT,
  },
  // A focused or invalid field gets a full-pixel border so the colour reads.
  fieldRest: { borderWidth: StyleSheet.hairlineWidth },
  fieldActive: { borderWidth: 1 },
  input: {
    ...inputTextStyle,
    flex: 1,
    // Android adds its own vertical padding that misaligns the text.
    paddingVertical: 0,
  },
  // A multi-line field does need the line height back — that is what keeps
  // wrapped lines from crowding each other — and its text starts at the top.
  inputMultiline: {
    lineHeight: bodyLineHeight,
    textAlignVertical: 'top',
  },
  adornment: { alignItems: 'center', justifyContent: 'center' },
});
