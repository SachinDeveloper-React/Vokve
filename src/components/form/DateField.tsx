import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { StyleSheet } from 'react-native';
import { radius, spacing, useTheme } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { BottomSheet } from '../disclosure/BottomSheet';
import { FormControl, type FormControlProps } from './FormControl';
import { INPUT_MIN_HEIGHT } from './Input';
import { PickerColumn } from './PickerColumn';
import { Pressable } from './Pressable';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface Parts {
  day: number;
  month: number;
  year: number;
}

/** Days in a month, leap years included. `month` is 1-based. */
export const daysInMonth = (month: number, year: number): number =>
  new Date(year, month, 0).getDate();

/** Splits an ISO `YYYY-MM-DD` date, or returns null if it is not one. */
export function parseIsoDate(value: string | null | undefined): Parts | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) {
    return null;
  }
  return { day, month, year };
}

const pad = (value: number) => String(value).padStart(2, '0');

const toIsoDate = ({ day, month, year }: Parts): string =>
  `${year}-${pad(month)}-${pad(day)}`;

/** `DD / MM / YYYY`, matching the placeholder an empty field shows. */
export function formatDateField(
  value: string | null | undefined,
): string | null {
  const parts = parseIsoDate(value);
  return parts
    ? `${pad(parts.day)} / ${pad(parts.month)} / ${parts.year}`
    : null;
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

interface Props extends Omit<FormControlProps, 'children'> {
  /** ISO `YYYY-MM-DD`, or empty while unanswered. */
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  sheetTitle?: string;
  /** Youngest age the field will offer. Defaults to 13. */
  minimumAge?: number;
  /** Oldest age the field will offer. Defaults to 100. */
  maximumAge?: number;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

/**
 * A date field that picks its value from three scrolling columns.
 *
 * Typed dates are a trap on a phone: the keyboard covers the field, `DD/MM`
 * and `MM/DD` are indistinguishable to a parser, and a birth date is not
 * something anyone enjoys mistyping twice. Columns cannot produce an invalid
 * date at all — the day list is rebuilt from the chosen month, so 31 February
 * is never on offer.
 *
 * Choices are held as a draft until Done. Committing on every tap would fire a
 * change for each year passed on the way to the right one, and in a validated
 * form that means an error message flickering under a field mid-scroll.
 */
export const DateField = memo(
  ({
    value,
    onChange,
    placeholder = 'DD / MM / YYYY',
    sheetTitle,
    minimumAge = 13,
    maximumAge = 100,
    leading,
    trailing,
    ...control
  }: Props) => {
    const { colors } = useTheme();
    const [isOpen, setOpen] = useState(false);

    const years = useMemo(() => {
      const thisYear = new Date().getFullYear();
      // Newest first: a sign-up form's users are far likelier to be 20 than 95.
      return range(thisYear - maximumAge, thisYear - minimumAge).reverse();
    }, [minimumAge, maximumAge]);

    const selected = useMemo(() => parseIsoDate(value), [value]);
    const fallback = useMemo<Parts>(
      () => ({ day: 1, month: 1, year: years[Math.floor(years.length / 2)] }),
      [years],
    );

    const [draft, setDraft] = useState<Parts>(selected ?? fallback);

    // Re-seeds the columns each time the sheet opens, so reopening after a
    // dismissal starts from the committed value, not the abandoned draft.
    useEffect(() => {
      if (isOpen) {
        setDraft(selected ?? fallback);
      }
    }, [isOpen, selected, fallback]);

    const open = useCallback(() => setOpen(true), []);
    const close = useCallback(() => setOpen(false), []);

    const days = useMemo(
      () => range(1, daysInMonth(draft.month, draft.year)),
      [draft.month, draft.year],
    );

    const setPart = useCallback((part: keyof Parts, next: number) => {
      setDraft(current => {
        const merged = { ...current, [part]: next };
        // Moving to a shorter month must not leave the 31st selected.
        return {
          ...merged,
          day: Math.min(merged.day, daysInMonth(merged.month, merged.year)),
        };
      });
    }, []);

    const setDay = useCallback((next: number) => setPart('day', next), [setPart]);
    const setMonth = useCallback(
      (next: number) => setPart('month', next),
      [setPart],
    );
    const setYear = useCallback(
      (next: number) => setPart('year', next),
      [setPart],
    );

    const confirm = useCallback(() => {
      onChange(toIsoDate(draft));
      setOpen(false);
    }, [draft, onChange]);

    const display = formatDateField(value);
    const borderColor = control.error ? colors.destructive : colors.input;

    return (
      <>
        <FormControl {...control}>
          <Pressable
            onPress={open}
            disabled={control.disabled}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel={control.label ?? 'Date'}
            accessibilityValue={{ text: display ?? placeholder }}
            accessibilityHint="Opens a date picker"
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
              {trailing}
            </HStack>
          </Pressable>
        </FormControl>

        <BottomSheet
          visible={isOpen}
          onClose={close}
          title={sheetTitle ?? control.label ?? 'Select a date'}
        >
          <VStack gap="base">
            <HStack gap="sm" align="stretch">
              <PickerColumn
                title="Day"
                options={days}
                selected={draft.day}
                format={pad}
                onSelect={setDay}
              />
              <PickerColumn
                title="Month"
                options={MONTH_VALUES}
                selected={draft.month}
                format={monthName}
                onSelect={setMonth}
              />
              <PickerColumn
                title="Year"
                options={years}
                selected={draft.year}
                format={String}
                onSelect={setYear}
              />
            </HStack>

            <Button label="Done" variant="brand" fullWidth onPress={confirm} />
          </VStack>
        </BottomSheet>
      </>
    );
  },
);

DateField.displayName = 'DateField';

const MONTH_VALUES = range(1, 12);
const monthName = (month: number) => MONTHS[month - 1];


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
