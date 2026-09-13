import React, { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';

export interface FormControlProps {
  children: React.ReactNode;
  label?: string;
  /** Guidance shown while the field is valid. Replaced by `error`. */
  helper?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /**
   * Layout for the whole control — its share of a row, usually.
   *
   * Distinct from a field's own `containerStyle`, which dresses the bordered
   * box: a `flex` on that box is measured inside this wrapper, so a field told
   * to fill a row through the inner style collapses to its content instead.
   */
  style?: StyleProp<ViewStyle>;
}

/**
 * Wraps a control with its label, helper text and error message.
 *
 * Helper and error occupy the same slot: showing both stacks two lines of
 * small text under a field and makes it ambiguous which one the user should
 * act on. The error always wins while it is present.
 */
export const FormControl = memo(
  ({
    children,
    label,
    helper,
    error,
    required = false,
    disabled = false,
    style,
  }: FormControlProps) => {
    const { colors } = useTheme();
    const message = error ?? helper;

    return (
      <View style={[styles.container, disabled && styles.disabled, style]}>
        {label ? (
          <View style={styles.labelRow}>
            <AppText variant="caption" color="textSecondary">
              {label}
            </AppText>
            {required ? (
              <AppText
                variant="caption"
                style={{ color: colors.destructive }}
                accessibilityLabel="required"
              >
                *
              </AppText>
            ) : null}
          </View>
        ) : null}

        {children}

        {message ? (
          <AppText
            variant="caption"
            color={error ? 'destructive' : 'textTertiary'}
            accessibilityLiveRegion={error ? 'polite' : 'none'}
          >
            {message}
          </AppText>
        ) : null}
      </View>
    );
  },
);

FormControl.displayName = 'FormControl';

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  labelRow: { flexDirection: 'row', gap: spacing.xxs, alignItems: 'center' },
  disabled: { opacity: 0.5 },
});
