import React, { forwardRef, useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import {
  COUNTRIES,
  DEFAULT_COUNTRY_CODE,
  findCountry,
} from '../../constants/countries';
import { radius, spacing, typography, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { Box } from '../layout/Box';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';
import { BottomSheet, BottomSheetScrollView } from '../disclosure/BottomSheet';
import { FormControl, type FormControlProps } from './FormControl';
import { INPUT_MIN_HEIGHT, inputTextStyle } from './Input';
import { Pressable } from './Pressable';

export interface PhoneValue {
  /** ISO 3166-1 alpha-2 code, keyed into `COUNTRIES`. */
  country: string;
  /** Digits only, without the dial code. */
  number: string;
}

export const EMPTY_PHONE: PhoneValue = {
  country: DEFAULT_COUNTRY_CODE,
  number: '8700707668',
};

/** Renders a phone value the way it is stored on the server. */
export const formatPhone = ({ country, number }: PhoneValue): string =>
  number ? `${findCountry(country).dialCode}${number}` : '';

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
  value: PhoneValue;
  onChange: (value: PhoneValue) => void;
  leading?: React.ReactNode;
  disabled?: boolean;
}

const FLAG_SIZE = moderateScale(18);

type TextInputRef = React.ComponentRef<typeof TextInput>;

/**
 * A phone number field with its country dial code attached.
 *
 * The two halves are one control rather than two adjacent fields because they
 * are one answer: a number without its country code is not a phone number, and
 * splitting them into separate form fields lets a form submit half of one.
 *
 * Non-digits are stripped as the user types. People paste numbers with spaces,
 * dashes and brackets in them, and silently normalising is friendlier than
 * rejecting a number that is perfectly valid once the punctuation is gone.
 */
export const PhoneInput = forwardRef<TextInputRef, Props>(
  (
    {
      value,
      onChange,
      label,
      helper,
      error,
      required,
      disabled = false,
      leading,
      onFocus,
      onBlur,
      ...rest
    },
    ref,
  ) => {
    const { colors } = useTheme();
    const [isFocused, setFocused] = useState(false);
    const [isPickerOpen, setPickerOpen] = useState(false);

    const country = useMemo(() => findCountry(value.country), [value.country]);

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

    const handleNumber = useCallback(
      (next: string) => {
        onChange({ ...value, number: next.replace(/\D/g, '') });
      },
      [onChange, value],
    );

    const openPicker = useCallback(() => setPickerOpen(true), []);
    const closePicker = useCallback(() => setPickerOpen(false), []);

    const selectCountry = useCallback(
      (code: string) => () => {
        onChange({ ...value, country: code });
        setPickerOpen(false);
      },
      [onChange, value],
    );

    const borderColor = error
      ? colors.destructive
      : isFocused
      ? colors.primary
      : colors.input;

    return (
      <>
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
            <HStack align="center" gap="sm" flex={1}>
              {leading}

              <Pressable
                onPress={openPicker}
                disabled={disabled}
                feedback="opacity"
                accessibilityRole="button"
                accessibilityLabel="Country dial code"
                accessibilityValue={{
                  text: `${country.name} ${country.dialCode}`,
                }}
                accessibilityHint="Opens a list of countries"
              >
                <HStack align="center" gap="xs">
                  <Text style={styles.flag} allowFontScaling={false}>
                    {country.flag}
                  </Text>
                  <AppText variant="body">{country.dialCode}</AppText>
                  <Icon as={ChevronDown} size="sm" color="textTertiary" />
                </HStack>
              </Pressable>

              <Divider orientation="vertical" inset="xxs" />

              <TextInput
                ref={ref}
                style={[styles.input, { color: colors.text }]}
                value={value.number}
                onChangeText={handleNumber}
                placeholderTextColor={colors.textTertiary}
                editable={!disabled}
                onFocus={handleFocus}
                onBlur={handleBlur}
                keyboardType="phone-pad"
                accessibilityLabel={label ?? 'Phone number'}
                accessibilityState={{ disabled }}
                {...rest}
              />
            </HStack>
          </Box>
        </FormControl>

        <BottomSheet
          visible={isPickerOpen}
          onClose={closePicker}
          title="Select country"
        >
          <BottomSheetScrollView
            style={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {COUNTRIES.map(option => {
              const isSelected = option.code === country.code;
              return (
                <Pressable
                  key={option.code}
                  onPress={selectCountry(option.code)}
                  feedback="highlight"
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${option.name} ${option.dialCode}`}
                  style={styles.option}
                >
                  <HStack align="center" gap="md">
                    <Text style={styles.flag} allowFontScaling={false}>
                      {option.flag}
                    </Text>
                    <VStack flex={1}>
                      <AppText variant="body" numberOfLines={1}>
                        {option.name}
                      </AppText>
                    </VStack>
                    <AppText variant="body" color="textSecondary">
                      {option.dialCode}
                    </AppText>
                    {isSelected ? (
                      <Icon as={Check} size="md" color="primary" />
                    ) : null}
                  </HStack>
                </Pressable>
              );
            })}
          </BottomSheetScrollView>
        </BottomSheet>
      </>
    );
  },
);

PhoneInput.displayName = 'PhoneInput';

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
  // Emoji flags have no theme colour to take, and scaling them with the OS
  // text setting would push the dial code off the row. The line height matches
  // the dial code's so the flag, the code and the chevron share one centre
  // line instead of each sitting in a box of its own height.
  flag: {
    fontSize: FLAG_SIZE,
    lineHeight: typography.body.lineHeight,
    includeFontPadding: false,
  },
  list: { maxHeight: 380 },
  option: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    minHeight: 52,
    justifyContent: 'center',
  },
});
