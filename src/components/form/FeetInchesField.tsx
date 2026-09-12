import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Icon } from '../media/Icon';
import { BottomSheet } from '../disclosure/BottomSheet';
import { FormControl, type FormControlProps } from './FormControl';
import { INPUT_MIN_HEIGHT } from './Input';
import { PickerColumn } from './PickerColumn';
import { Pressable } from './Pressable';

const INCHES_PER_FOOT = 12;

/** The range a human height falls in. 3'0" to 8'11". */
const FEET = { min: 3, max: 8 };

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

const FEET_OPTIONS = range(FEET.min, FEET.max);
const INCH_OPTIONS = range(0, INCHES_PER_FOOT - 1);

export const toFeetAndInches = (totalInches: number) => ({
  feet: Math.floor(totalInches / INCHES_PER_FOOT),
  inches: Math.round(totalInches % INCHES_PER_FOOT),
});

export const fromFeetAndInches = (feet: number, inches: number) =>
  feet * INCHES_PER_FOOT + inches;

/** `5' 9"` — how the number is written everywhere it is actually used. */
export function formatFeetAndInches(totalInches: number | null): string | null {
  if (totalInches === null || totalInches <= 0) {
    return null;
  }
  const { feet, inches } = toFeetAndInches(totalInches);
  return `${feet}' ${inches}"`;
}

interface Props extends Omit<FormControlProps, 'children'> {
  /** Total inches, which is what the form and the converter both work in. */
  value: number | null;
  onChange: (value: number) => void;
  placeholder?: string;
  sheetTitle?: string;
  /** Shown as a chip inside the field. Tapping it changes the unit system. */
  unit?: string;
  onUnitPress?: () => void;
  leading?: React.ReactNode;
}

/**
 * An imperial height, picked as feet and inches.
 *
 * Typing is the wrong input here even though the value is one number. Nobody
 * knows their height in inches — they know it as 5'9", and converting that in
 * their head to 69 is a step the app can simply not ask for. It is also the
 * step where a stray digit turns 69 into 6 or 699 with nothing on screen
 * looking wrong.
 *
 * The value is still a single total in inches, so the metric conversion and
 * the stored `heightCm` need no special case: only the way it is *entered*
 * changes with the unit.
 */
export const FeetInchesField = memo(
  ({
    value,
    onChange,
    placeholder = "5' 9\"",
    sheetTitle,
    unit,
    onUnitPress,
    leading,
    ...control
  }: Props) => {
    const { colors } = useTheme();
    const [isOpen, setOpen] = useState(false);

    const selected = useMemo(
      () => (value && value > 0 ? toFeetAndInches(value) : null),
      [value],
    );

    /** Roughly 5'7" — near the middle of the range, so neither end is far. */
    const fallback = useMemo(() => ({ feet: 5, inches: 7 }), []);
    const [draft, setDraft] = useState(selected ?? fallback);

    // Re-seeds on open, so reopening after a dismissal starts from the
    // committed height rather than the abandoned draft.
    useEffect(() => {
      if (isOpen) {
        setDraft(selected ?? fallback);
      }
    }, [isOpen, selected, fallback]);

    const open = useCallback(() => setOpen(true), []);
    const close = useCallback(() => setOpen(false), []);

    const setFeet = useCallback(
      (feet: number) => setDraft(current => ({ ...current, feet })),
      [],
    );
    const setInches = useCallback(
      (inches: number) => setDraft(current => ({ ...current, inches })),
      [],
    );

    const confirm = useCallback(() => {
      onChange(fromFeetAndInches(draft.feet, draft.inches));
      setOpen(false);
    }, [draft, onChange]);

    const display = formatFeetAndInches(value);
    const borderColor = control.error ? colors.destructive : colors.input;

    return (
      <>
        <FormControl {...control}>
          <Pressable
            onPress={open}
            disabled={control.disabled}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel={control.label ?? 'Height'}
            accessibilityValue={{ text: display ?? placeholder }}
            accessibilityHint="Opens a height picker"
            style={[
              styles.field,
              { backgroundColor: colors.inputBackground, borderColor },
            ]}
          >
            <HStack align="center" gap="sm">
              {leading}
              <AppText
                variant="body"
                color={display ? 'text' : 'textTertiary'}
                numberOfLines={1}
                style={styles.value}
              >
                {display ?? placeholder}
              </AppText>

              {unit && onUnitPress ? (
                <Pressable
                  onPress={onUnitPress}
                  disabled={control.disabled}
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
              ) : null}
            </HStack>
          </Pressable>
        </FormControl>

        <BottomSheet
          visible={isOpen}
          onClose={close}
          title={sheetTitle ?? control.label ?? 'Select your height'}
        >
          <VStack gap="base">
            <Box>
              <AppText variant="metric" center>
                {`${draft.feet}' ${draft.inches}"`}
              </AppText>
            </Box>

            <HStack gap="sm" align="stretch">
              <PickerColumn
                title="Feet"
                options={FEET_OPTIONS}
                selected={draft.feet}
                format={String}
                onSelect={setFeet}
              />
              <PickerColumn
                title="Inches"
                options={INCH_OPTIONS}
                selected={draft.inches}
                format={String}
                onSelect={setInches}
              />
            </HStack>

            <Button label="Done" variant="brand" fullWidth onPress={confirm} />
          </VStack>
        </BottomSheet>
      </>
    );
  },
);

FeetInchesField.displayName = 'FeetInchesField';

const styles = StyleSheet.create({
  field: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.base,
    minHeight: INPUT_MIN_HEIGHT,
    justifyContent: 'center',
  },
  value: { flex: 1 },
});
