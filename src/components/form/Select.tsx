import React, { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';
import { VStack } from '../layout/Stack';
import { BottomSheet, BottomSheetScrollView } from '../disclosure/BottomSheet';
import { OptionRow, type SheetOption } from '../disclosure/OptionRow';
import { FormControl, type FormControlProps } from './FormControl';
import { INPUT_MIN_HEIGHT } from './Input';
import { Pressable } from './Pressable';

/**
 * A field's options are a picker's options: the same row draws both, so a
 * form's sheet and a screen's own `OptionSheet` cannot drift apart.
 */
export type SelectOption<T extends string> = SheetOption<T>;

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
    (next: T) => {
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
          <VStack gap="sm" pb="base" accessibilityRole="radiogroup">
            {options.map(option => (
              <OptionRow
                key={option.value}
                option={option}
                selected={option.value === value}
                onSelect={select}
              />
            ))}
          </VStack>
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
});
