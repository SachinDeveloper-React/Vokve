import React, { memo, useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { radius, spacing, useTheme } from '../../theme';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { BottomSheetScrollView } from '../disclosure/BottomSheet';
import { Pressable } from './Pressable';

/** One row's height, and the interval the column snaps to. */
export const PICKER_ROW_HEIGHT = 44;
export const PICKER_COLUMN_HEIGHT = 220;

interface Props {
  title: string;
  options: number[];
  selected: number;
  /** Renders an option — `pad` for days, a month name, a plain number. */
  format: (value: number) => string;
  onSelect: (value: number) => void;
}

/**
 * One scrolling column of a wheel-style picker.
 *
 * Shared by every picker that offers a bounded set of numbers — a date's day,
 * month and year, a height's feet and inches. The reason it is one component
 * rather than a copy per picker is the scroll-to-selected below: it is a
 * platform workaround, and a second copy is a second place for it to rot.
 */
export const PickerColumn = memo(
  ({ title, options, selected, format, onSelect }: Props) => {
    // RN 0.87 types a ScrollView ref as `ScrollViewInstance`, not `ScrollView`.
    const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
    const index = options.indexOf(selected);

    // `contentOffset` would do this in one prop, but it is iOS-only; an
    // imperative scroll after mount is the version that also lands on Android.
    useEffect(() => {
      if (index > 0) {
        scroller.current?.scrollTo({
          y: index * PICKER_ROW_HEIGHT,
          animated: false,
        });
      }
      // Only on mount: re-running would yank the column back under the thumb
      // every time the user picks a value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <VStack flex={1} gap="xs">
        <AppText variant="label" color="textTertiary" center>
          {title}
        </AppText>
        <BottomSheetScrollView
          ref={scroller}
          style={styles.column}
          showsVerticalScrollIndicator={false}
          snapToInterval={PICKER_ROW_HEIGHT}
          decelerationRate="fast"
        >
          {options.map(option => (
            <PickerRow
              key={option}
              title={title}
              value={option}
              label={format(option)}
              selected={option === selected}
              onSelect={onSelect}
            />
          ))}
        </BottomSheetScrollView>
      </VStack>
    );
  },
);

PickerColumn.displayName = 'PickerColumn';

interface RowProps {
  title: string;
  value: number;
  label: string;
  selected: boolean;
  onSelect: (value: number) => void;
}

const PickerRow = memo(
  ({ title, value, label, selected, onSelect }: RowProps) => {
    const { colors } = useTheme();
    const press = useCallback(() => onSelect(value), [onSelect, value]);

    return (
      <Pressable
        onPress={press}
        feedback="highlight"
        accessibilityRole="button"
        accessibilityState={{ selected }}
        // Prefixed with the column so "Feet 5" and "Inches 5" stay distinct to
        // a screen reader, and to anything else reading by label.
        accessibilityLabel={`${title} ${label}`}
        style={[styles.row, selected && { backgroundColor: colors.accent }]}
      >
        <AppText
          variant={selected ? 'bodyStrong' : 'body'}
          color={selected ? 'text' : 'textSecondary'}
          center
        >
          {label}
        </AppText>
      </Pressable>
    );
  },
);

PickerRow.displayName = 'PickerRow';

const styles = StyleSheet.create({
  column: { height: PICKER_COLUMN_HEIGHT },
  row: {
    height: PICKER_ROW_HEIGHT,
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
  },
});
