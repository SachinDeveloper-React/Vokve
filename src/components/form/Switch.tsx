import React, { memo, useCallback } from 'react';
import { StyleSheet, Switch as RNSwitch, View } from 'react-native';
import { spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';

interface Props {
  value: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  helper?: string;
  disabled?: boolean;
}

/**
 * A labelled toggle row.
 *
 * Wraps the platform Switch rather than reimplementing it: the native control
 * already matches each OS's motion and, on iOS, responds to a horizontal drag
 * as well as a tap — behaviour a custom toggle almost always loses.
 */
export const Switch = memo(
  ({ value, onChange, label, helper, disabled = false }: Props) => {
    const { colors } = useTheme();
    const handleChange = useCallback(
      (next: boolean) => onChange(next),
      [onChange],
    );

    return (
      <View
        style={[styles.row, disabled && styles.disabled]}
        accessibilityRole="none"
      >
        {label ? (
          <View style={styles.text}>
            <AppText variant="body">{label}</AppText>
            {helper ? (
              <AppText variant="caption" color="textSecondary">
                {helper}
              </AppText>
            ) : null}
          </View>
        ) : null}

        <RNSwitch
          value={value}
          onValueChange={handleChange}
          disabled={disabled}
          accessibilityLabel={label}
          accessibilityHint={helper}
          trackColor={{
            false: colors.switchBackground,
            true: colors.primary,
          }}
          thumbColor={colors.primaryForeground}
          // Android tints the track behind the thumb with this.
          ios_backgroundColor={colors.switchBackground}
        />
      </View>
    );
  },
);

Switch.displayName = 'Switch';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.base,
    minHeight: 44,
  },
  text: { flex: 1, gap: spacing.xxs },
  disabled: { opacity: 0.5 },
});
