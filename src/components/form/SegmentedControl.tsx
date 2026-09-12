import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { Divider } from '../layout/Divider';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';
import { FormControl, type FormControlProps } from './FormControl';
import { INPUT_MIN_HEIGHT } from './Input';
import { Pressable } from './Pressable';

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Colour for this segment's icon, and the wash behind it once chosen. */
  tint?: string;
  disabled?: boolean;
}

interface Props<T extends string> extends Omit<FormControlProps, 'children'> {
  segments: Segment<T>[];
  value: T | null;
  onChange: (value: T) => void;
}

/**
 * A single-choice control that shows every option at once, side by side.
 *
 * Where `RadioGroup` stacks its options down the screen and `Select` hides
 * them behind a sheet, this is for the two-to-four-option case that is short
 * enough to read in a glance — gender, a unit system, a difficulty. Past four
 * the segments get too narrow to label honestly and one of the other two is
 * the right control.
 *
 * The selection is carried by a filled background *and* a weight change on the
 * label, never by colour alone: a tint that reads clearly to most people is
 * often the same grey as its neighbour to someone colour-blind.
 */
function SegmentedControlInner<T extends string>({
  segments,
  value,
  onChange,
  ...control
}: Props<T>) {
  const { colors, isDark } = useTheme();

  const borderColor = control.error ? colors.destructive : colors.input;

  return (
    <FormControl {...control}>
      <Box
        style={[
          styles.track,
          { backgroundColor: colors.inputBackground, borderColor },
        ]}
        accessibilityRole="radiogroup"
      >
        <HStack align="stretch">
          {segments.map((segment, index) => (
            <React.Fragment key={segment.value}>
              {index > 0 ? <Divider orientation="vertical" /> : null}
              <SegmentButton
                segment={segment}
                selected={segment.value === value}
                disabled={segment.disabled ?? control.disabled}
                tint={segment.tint ?? colors.primary}
                wash={withAlpha(
                  segment.tint ?? colors.primary,
                  isDark ? 0.22 : 0.12,
                )}
                onChange={onChange}
              />
            </React.Fragment>
          ))}
        </HStack>
      </Box>
    </FormControl>
  );
}

interface SegmentButtonProps<T extends string> {
  segment: Segment<T>;
  selected: boolean;
  disabled?: boolean;
  tint: string;
  wash: string;
  onChange: (value: T) => void;
}

function SegmentButtonInner<T extends string>({
  segment,
  selected,
  disabled,
  tint,
  wash,
  onChange,
}: SegmentButtonProps<T>) {
  const { colors } = useTheme();
  const select = useCallback(
    () => onChange(segment.value),
    [onChange, segment.value],
  );

  return (
    <Pressable
      onPress={select}
      disabled={disabled}
      feedback="highlight"
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      accessibilityLabel={segment.label}
      style={[styles.segment, selected && { backgroundColor: wash }]}
    >
      <HStack align="center" justify="center" gap="xs">
        {segment.icon ? (
          <Icon
            as={segment.icon}
            size="sm"
            tint={selected ? tint : colors.textTertiary}
          />
        ) : null}
        <AppText
          variant={selected ? 'bodyStrong' : 'body'}
          color={selected ? 'text' : 'textSecondary'}
          numberOfLines={1}
        >
          {segment.label}
        </AppText>
      </HStack>
    </Pressable>
  );
}

const SegmentButton = memo(SegmentButtonInner) as typeof SegmentButtonInner;

export const SegmentedControl = memo(
  SegmentedControlInner,
) as typeof SegmentedControlInner;

const styles = StyleSheet.create({
  // `overflow: hidden` is what clips a selected end segment's fill to the
  // track's rounded corner instead of letting it square off over the border.
  track: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    justifyContent: 'center',
    minHeight: INPUT_MIN_HEIGHT,
  },
});
