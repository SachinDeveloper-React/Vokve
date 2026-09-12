import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { moderateScale } from '../../theme/responsive';
import { spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';
import { FormControl, type FormControlProps } from './FormControl';
import { Pressable } from './Pressable';

const DOT_SIZE = moderateScale(22);

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  helper?: string;
  disabled?: boolean;
}

interface RadioProps {
  selected: boolean;
  onSelect: () => void;
  label: string;
  helper?: string;
  disabled?: boolean;
}

export const Radio = memo(
  ({ selected, onSelect, label, helper, disabled = false }: RadioProps) => {
    const { colors } = useTheme();

    return (
      <Pressable
        onPress={onSelect}
        disabled={disabled}
        feedback="opacity"
        visualSize={DOT_SIZE}
        accessibilityRole="radio"
        accessibilityState={{ selected, disabled }}
        accessibilityLabel={label}
        accessibilityHint={helper}
        style={styles.row}
      >
        <View
          style={[
            styles.outer,
            { borderColor: selected ? colors.primary : colors.switchBackground },
          ]}
        >
          {selected ? (
            <View style={[styles.inner, { backgroundColor: colors.primary }]} />
          ) : null}
        </View>

        <View style={styles.text}>
          <AppText variant="body">{label}</AppText>
          {helper ? (
            <AppText variant="caption" color="textSecondary">
              {helper}
            </AppText>
          ) : null}
        </View>
      </Pressable>
    );
  },
);

Radio.displayName = 'Radio';

interface GroupProps<T extends string> extends Omit<FormControlProps, 'children'> {
  options: RadioOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
}

/**
 * A single-choice group.
 *
 * `accessibilityRole="radiogroup"` on the container is what tells a screen
 * reader these options are mutually exclusive; without it each row is
 * announced as an unrelated control.
 */
function RadioGroupInner<T extends string>({
  options,
  value,
  onChange,
  ...control
}: GroupProps<T>) {
  const handleSelect = useCallback(
    (next: T) => () => onChange(next),
    [onChange],
  );

  return (
    <FormControl {...control}>
      <View style={styles.group} accessibilityRole="radiogroup">
        {options.map(option => (
          <Radio
            key={option.value}
            label={option.label}
            helper={option.helper}
            disabled={option.disabled ?? control.disabled}
            selected={option.value === value}
            onSelect={handleSelect(option.value)}
          />
        ))}
      </View>
    </FormControl>
  );
}

export const RadioGroup = memo(RadioGroupInner) as typeof RadioGroupInner;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  group: { gap: spacing.base },
  outer: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  inner: {
    width: DOT_SIZE / 2,
    height: DOT_SIZE / 2,
    borderRadius: DOT_SIZE / 4,
  },
  text: { flex: 1, gap: spacing.xxs },
});
