import React, { memo, useCallback, useEffect, useState } from 'react';
import { BottomSheet } from '../disclosure/BottomSheet';
import { HStack, VStack } from '../layout/Stack';
import { Button } from '../ui/Button';
import { PickerColumn } from './PickerColumn';

const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
/** Five-minute steps: a reminder at 7:23 is precision nobody asked for. */
const MINUTES = Array.from({ length: 12 }, (_, index) => index * 5);
/** 0 is AM, 1 is PM — the column takes numbers. */
const PERIODS = [0, 1];

const pad = (value: number) => String(value).padStart(2, '0');

interface Parts {
  hour12: number;
  minute: number;
  period: number;
}

/** `HH:mm` in 24-hour time, which is how a reminder is stored. */
function toTimeString({ hour12, minute, period }: Parts): string {
  const hours = (hour12 % 12) + period * 12;
  return `${pad(hours)}:${pad(minute)}`;
}

/** Splits `HH:mm` into the three columns, rounded to the nearest step. */
function fromTimeString(time: string): Parts {
  const [hours, minutes] = time.split(':').map(Number);
  const safeHours = Number.isFinite(hours) ? hours : 8;
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;

  return {
    hour12: safeHours % 12 === 0 ? 12 : safeHours % 12,
    minute: Math.min(55, Math.round(safeMinutes / 5) * 5),
    period: safeHours < 12 ? 0 : 1,
  };
}

interface Props {
  visible: boolean;
  /** The time the columns open on, `HH:mm`. */
  value: string;
  onSubmit: (time: string) => void;
  onClose: () => void;
  title?: string;
  submitLabel?: string;
}

/**
 * A time of day, picked from three columns.
 *
 * Columns rather than a typed field, which is the opposite of the custom water
 * amount next door: an amount is a number the user knows ("330"), where a time
 * is a point on a dial they are choosing, and typing "0930" is a format anyone
 * can get wrong two ways.
 *
 * The draft is held here until Add. Committing on every scroll would add a
 * reminder for each hour passed on the way to the right one.
 */
export const TimePickerSheet = memo(
  ({
    visible,
    value,
    onSubmit,
    onClose,
    title = 'Pick a time',
    submitLabel = 'Add time',
  }: Props) => {
    const [draft, setDraft] = useState<Parts>(() => fromTimeString(value));

    // Re-seeds the columns each time the sheet opens, so reopening after a
    // dismissal starts from the committed time, not the abandoned draft.
    useEffect(() => {
      if (visible) {
        setDraft(fromTimeString(value));
      }
    }, [value, visible]);

    const setHour = useCallback(
      (hour12: number) => setDraft(current => ({ ...current, hour12 })),
      [],
    );
    const setMinute = useCallback(
      (minute: number) => setDraft(current => ({ ...current, minute })),
      [],
    );
    const setPeriod = useCallback(
      (period: number) => setDraft(current => ({ ...current, period })),
      [],
    );

    const confirm = useCallback(() => {
      onSubmit(toTimeString(draft));
      onClose();
    }, [draft, onClose, onSubmit]);

    return (
      <BottomSheet visible={visible} onClose={onClose} title={title}>
        <VStack gap="base" pb="base">
          <HStack align="stretch" gap="sm">
            <PickerColumn
              title="Hour"
              options={HOURS}
              selected={draft.hour12}
              format={pad}
              onSelect={setHour}
            />
            <PickerColumn
              title="Minute"
              options={MINUTES}
              selected={draft.minute}
              format={pad}
              onSelect={setMinute}
            />
            <PickerColumn
              title="AM / PM"
              options={PERIODS}
              selected={draft.period}
              format={period => (period === 0 ? 'AM' : 'PM')}
              onSelect={setPeriod}
            />
          </HStack>

          <Button label={submitLabel} size="lg" fullWidth onPress={confirm} />
        </VStack>
      </BottomSheet>
    );
  },
);

TimePickerSheet.displayName = 'TimePickerSheet';
