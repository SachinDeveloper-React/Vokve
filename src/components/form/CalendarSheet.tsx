import React, { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import {
  formatLongDate,
  fromIsoDate,
  toIsoDate,
  todayIso,
  type IsoDate,
} from '../../utils/date';
import { BottomSheet } from '../disclosure/BottomSheet';
import { Grid } from '../layout/Grid';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { MonthNav } from '../streak/MonthNav';
import { Pressable } from './Pressable';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The day disc's diameter at the 375pt baseline; seven share a row. */
const DISC = moderateScale(34);

interface Cell {
  iso: IsoDate;
  day: number;
  /** A day drawn from the month either side, to keep the rows aligned. */
  outside: boolean;
}

/**
 * Lays a month out Monday-first, padded at both ends with the neighbouring
 * months' days so every row has seven cells and the weekday header lines up.
 */
function cellsFor(year: number, month: number): Cell[] {
  const first = new Date(year, month, 1);
  // `getDay` is Sunday-first; the row is Monday-first.
  const leading = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((leading + daysInMonth) / 7) * 7;

  return Array.from({ length: total }, (_, index) => {
    // `Date` normalises a day of 0 or 32 into the neighbouring month.
    const date = new Date(year, month, index - leading + 1);
    return {
      iso: toIsoDate(date),
      day: date.getDate(),
      outside: date.getMonth() !== month,
    };
  });
}

interface DayProps {
  cell: Cell;
  selected: boolean;
  isToday: boolean;
  onPress: (iso: IsoDate) => void;
}

const CalendarSheetDay = memo(
  ({ cell, selected, isToday, onPress }: DayProps) => {
    const { colors } = useTheme();
    const press = useCallback(() => onPress(cell.iso), [cell.iso, onPress]);

    return (
      <Pressable
        onPress={press}
        feedback="opacity"
        visualSize={DISC}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={formatLongDate(cell.iso)}
      >
        <View
          style={[
            styles.disc,
            selected
              ? { backgroundColor: colors.primary }
              : isToday
              ? { backgroundColor: colors.muted }
              : null,
          ]}
        >
          <AppText
            variant="micro"
            style={[
              styles.number,
              {
                color: selected
                  ? colors.primaryForeground
                  : cell.outside
                  ? colors.textTertiary
                  : colors.text,
              },
            ]}
          >
            {cell.day}
          </AppText>
        </View>
      </Pressable>
    );
  },
);

CalendarSheetDay.displayName = 'CalendarSheetDay';

interface Props {
  visible: boolean;
  /** The day currently chosen, which the sheet opens on. */
  value: IsoDate;
  onChange: (value: IsoDate) => void;
  onClose: () => void;
  title?: string;
}

/**
 * A month calendar in a sheet, for choosing the day a screen is anchored to.
 *
 * A calendar rather than `DateField`'s scrolling columns. Those are built for a
 * date the user knows and has to enter — a birthday, twenty years back, where
 * a calendar would be hundreds of pages of paging. This is the opposite case:
 * the day wanted is within a week or two of now, and what the user is actually
 * looking for is "last Tuesday", which only a calendar can show them.
 *
 * Days ahead of today are offered rather than blocked: the screens that use
 * this show what is scheduled as well as what has happened, and a challenge
 * that opens on Friday is a fair thing to want to look at on Wednesday.
 *
 * The month being browsed is state of its own, reset each time the sheet opens
 * — a user who paged to March, closed the sheet and came back would otherwise
 * find the calendar still in March with the chosen day nowhere on screen.
 */
export const CalendarSheet = memo(
  ({ visible, value, onChange, onClose, title = 'Select date' }: Props) => {
    const today = todayIso();
    const anchor = fromIsoDate(value);
    const [browsing, setBrowsing] = useState({
      year: anchor.getFullYear(),
      month: anchor.getMonth(),
    });

    // Keyed on the sheet opening rather than on every render: while it is open
    // the month is the user's to page through, and re-deriving it from `value`
    // would snap the calendar back the moment they looked at another month.
    const [wasVisible, setWasVisible] = useState(visible);
    if (visible !== wasVisible) {
      setWasVisible(visible);
      if (visible) {
        setBrowsing({ year: anchor.getFullYear(), month: anchor.getMonth() });
      }
    }

    const cells = useMemo(
      () => cellsFor(browsing.year, browsing.month),
      [browsing.month, browsing.year],
    );

    const previousMonth = useCallback(
      () =>
        setBrowsing(current =>
          current.month === 0
            ? { year: current.year - 1, month: 11 }
            : { year: current.year, month: current.month - 1 },
        ),
      [],
    );

    const nextMonth = useCallback(
      () =>
        setBrowsing(current =>
          current.month === 11
            ? { year: current.year + 1, month: 0 }
            : { year: current.year, month: current.month + 1 },
        ),
      [],
    );

    const handleSelect = useCallback(
      (iso: IsoDate) => {
        onChange(iso);
        onClose();
      },
      [onChange, onClose],
    );

    const selectToday = useCallback(() => handleSelect(today), [
      handleSelect,
      today,
    ]);

    return (
      <BottomSheet visible={visible} onClose={onClose} title={title}>
        <VStack gap="base" pb="base">
          <HStack align="center" justify="between">
            <MonthNav
              year={browsing.year}
              month={browsing.month}
              onPrevious={previousMonth}
              onNext={nextMonth}
              canGoNext
            />

            <Button
              label="Today"
              variant="ghost"
              size="xs"
              onPress={selectToday}
            />
          </HStack>

          <VStack gap="sm">
            <Grid columns={7} gap="xs">
              {WEEKDAYS.map(day => (
                <AppText key={day} variant="micro" color="textTertiary" center>
                  {day}
                </AppText>
              ))}
            </Grid>

            <Grid columns={7} gap="xs">
              {cells.map(cell => (
                <CalendarSheetDay
                  key={cell.iso}
                  cell={cell}
                  selected={cell.iso === value}
                  isToday={cell.iso === today}
                  onPress={handleSelect}
                />
              ))}
            </Grid>
          </VStack>
        </VStack>
      </BottomSheet>
    );
  },
);

CalendarSheet.displayName = 'CalendarSheet';

const styles = StyleSheet.create({
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  number: { fontWeight: '600' },
});
