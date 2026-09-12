import React, { forwardRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { spacing, typography } from '../../theme';
import { AppText } from '../ui/AppText';
import { Input, type InputProps } from './Input';

interface Props extends Omit<InputProps, 'multiline' | 'numberOfLines'> {
  /** Visible lines before the field starts scrolling. */
  rows?: number;
  /** Shows a live character count against `maxLength`. */
  showCount?: boolean;
}

/**
 * A multi-line field — workout notes, an exercise description.
 *
 * Height is fixed to `rows` rather than growing with the content: an
 * auto-growing field inside a scroll view pushes everything below it on every
 * keystroke, which makes typing feel unsteady.
 */
type TextInputRef = React.ComponentRef<typeof TextInput>;

export const TextArea = forwardRef<TextInputRef, Props>(
  ({ rows = 4, showCount = false, maxLength, value, helper, ...rest }, ref) => {
    const count = typeof value === 'string' ? value.length : 0;
    // The same line height the field's text is actually laid out with, so
    // `rows` means the number of lines that really fit.
    const { lineHeight } = typography.body;

    return (
      <View>
        <Input
          ref={ref}
          multiline
          value={value}
          maxLength={maxLength}
          helper={helper}
          textAlignVertical="top"
          containerStyle={{
            ...styles.area,
            minHeight: rows * lineHeight + spacing.xl,
          }}
          {...rest}
        />
        {showCount && maxLength ? (
          <AppText variant="caption" color="textTertiary" style={styles.count}>
            {`${count} / ${maxLength}`}
          </AppText>
        ) : null}
      </View>
    );
  },
);

TextArea.displayName = 'TextArea';

const styles = StyleSheet.create({
  // Text starts at the top of a multi-line field, not vertically centred.
  area: { alignItems: 'flex-start', paddingVertical: spacing.md },
  count: { alignSelf: 'flex-end', marginTop: spacing.xxs },
});
