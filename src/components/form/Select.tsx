import React, { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';
import {
  BottomSheet,
  BottomSheetScrollView,
} from '../disclosure/BottomSheet';
import { FormControl, type FormControlProps } from './FormControl';
import { INPUT_MIN_HEIGHT } from './Input';
import { Pressable } from './Pressable';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  helper?: string;
  disabled?: boolean;
}

interface Props<T extends string> extends Omit<FormControlProps, 'children'> {
  options: SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  /** Sheet heading. Falls back to the field's label. */
  sheetTitle?: string;
}

/**
 * A single-choice field that opens its options in a bottom sheet.
 *
 * Deliberately not a dropdown overlay: on a phone a list anchored to the field
 * ends up under the keyboard or off the bottom of the screen. A sheet always
 * has room, and its options are large enough to hit with a thumb.
 */
function SelectInner<T extends string>({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  sheetTitle,
  ...control
}: Props<T>) {
  const { colors } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const selected = useMemo(
    () => options.find(option => option.value === value) ?? null,
    [options, value],
  );

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const select = useCallback(
    (next: T) => () => {
      onChange(next);
      close();
    },
    [onChange, close],
  );

  const borderColor = control.error ? colors.destructive : colors.input;

  return (
    <>
      <FormControl {...control}>
        <Pressable
          onPress={open}
          disabled={control.disabled}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel={control.label ?? placeholder}
          accessibilityValue={{ text: selected?.label ?? placeholder }}
          accessibilityHint="Opens a list of options"
          style={[
            styles.field,
            { backgroundColor: colors.inputBackground, borderColor },
          ]}
        >
          <AppText
            variant="body"
            color={selected ? 'text' : 'textTertiary'}
            numberOfLines={1}
            style={styles.value}
          >
            {selected?.label ?? placeholder}
          </AppText>
          <Icon as={ChevronDown} size="md" color="textTertiary" />
        </Pressable>
      </FormControl>

      <BottomSheet
        visible={isOpen}
        onClose={close}
        title={sheetTitle ?? control.label}
      >
        <BottomSheetScrollView
          style={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {options.map(option => {
            const isSelected = option.value === value;
            return (
              <Pressable
                key={option.value}
                onPress={select(option.value)}
                disabled={option.disabled}
                feedback="highlight"
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={option.label}
                style={styles.option}
              >
                <View style={styles.optionText}>
                  <AppText variant="body">{option.label}</AppText>
                  {option.helper ? (
                    <AppText variant="caption" color="textSecondary">
                      {option.helper}
                    </AppText>
                  ) : null}
                </View>
                {isSelected ? (
                  <Icon as={Check} size="md" color="primary" />
                ) : null}
              </Pressable>
            );
          })}
        </BottomSheetScrollView>
      </BottomSheet>
    </>
  );
}

export const Select = memo(SelectInner) as typeof SelectInner;

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.base,
    minHeight: INPUT_MIN_HEIGHT,
  },
  value: { flex: 1 },
  list: { maxHeight: 360 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    minHeight: 52,
  },
  optionText: { flex: 1, gap: spacing.xxs },
});
