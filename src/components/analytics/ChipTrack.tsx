import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { radius, useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

export interface Chip<T extends string> {
  value: T;
  /** What is drawn. Room for a letter or two: "D", "30D". */
  label: string;
  /** What is spoken, since the label is too short to say itself: "Day", "30 days". */
  name: string;
}

interface ChipProps<T extends string> {
  chip: Chip<T>;
  selected: boolean;
  onPress: (value: T) => void;
}

/**
 * One chip of the track.
 *
 * The label is what the design gives it and the accessibility name is what
 * that label stands for: "D" announced on its own is a letter, not a period
 * of time.
 */
function TrackChipInner<T extends string>({
  chip,
  selected,
  onPress,
}: ChipProps<T>) {
  const { colors } = useTheme();
  const press = useCallback(() => onPress(chip.value), [chip.value, onPress]);

  return (
    <Pressable
      onPress={press}
      feedback="opacity"
      visualSize={28}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={chip.name}
    >
      <HStack
        align="center"
        justify="center"
        px="md"
        py="xs"
        style={[styles.chip, selected && { backgroundColor: colors.text }]}
      >
        <AppText
          variant="micro"
          style={[
            styles.label,
            { color: selected ? colors.card : colors.textSecondary },
          ]}
        >
          {chip.label}
        </AppText>
      </HStack>
    </Pressable>
  );
}

const TrackChip = memo(TrackChipInner) as typeof TrackChipInner;

interface Props<T extends string> {
  chips: readonly Chip<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * This screen's one-of-several control: short labels on a filled pill.
 *
 * Shared rather than written twice because the screen now carries two of them
 * — the chart's calendar periods and the overview's rolling ones — and two
 * tracks on one screen that drift apart by a point of padding read as two
 * different kinds of control rather than the same control twice.
 *
 * The selection is carried by the filled pill, not by the label's colour
 * alone, so it survives a reader who cannot tell the fill from the track.
 */
function ChipTrackInner<T extends string>({ chips, value, onChange }: Props<T>) {
  const { colors } = useTheme();

  return (
    <HStack
      align="center"
      gap="xxs"
      p="xxs"
      style={[styles.track, { backgroundColor: colors.muted }]}
    >
      {chips.map(chip => (
        <TrackChip
          key={chip.value}
          chip={chip}
          selected={chip.value === value}
          onPress={onChange}
        />
      ))}
    </HStack>
  );
}

export const ChipTrack = memo(ChipTrackInner) as typeof ChipTrackInner;

const styles = StyleSheet.create({
  track: { borderRadius: radius.pill },
  chip: { borderRadius: radius.pill },
  label: { fontWeight: '700' },
});
