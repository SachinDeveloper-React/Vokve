import React, { memo, useCallback, useEffect, useState } from 'react';
import { Switch as RNSwitch } from 'react-native';
import { useTheme } from '../../theme';
import type { QuietHours } from '../../stores/notificationSettingsStore';
import { formatTimeOfDay } from '../../utils/format';
import { BottomSheet } from '../disclosure/BottomSheet';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { PickerColumn } from '../form/PickerColumn';
import { Pressable } from '../form/Pressable';

const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
/** Quarter hours: a quiet window nobody sets to 22:07. */
const MINUTES = [0, 15, 30, 45];
const PERIODS = [0, 1];

const pad = (value: number) => String(value).padStart(2, '0');

interface Parts {
  hour12: number;
  minute: number;
  period: number;
}

function fromTime(time: string): Parts {
  const [hours, minutes] = time.split(':').map(Number);
  const safeHours = Number.isFinite(hours) ? hours : 22;
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;

  return {
    hour12: safeHours % 12 === 0 ? 12 : safeHours % 12,
    minute: MINUTES.reduce((closest, option) =>
      Math.abs(option - safeMinutes) < Math.abs(closest - safeMinutes)
        ? option
        : closest,
    ),
    period: safeHours < 12 ? 0 : 1,
  };
}

function toTime({ hour12, minute, period }: Parts): string {
  return `${pad((hour12 % 12) + period * 12)}:${pad(minute)}`;
}

interface Props {
  visible: boolean;
  value: QuietHours;
  onChange: (quietHours: Partial<QuietHours>) => void;
  onClose: () => void;
}

/**
 * The quiet window, set in one sheet.
 *
 * The two times are edited *inside* this sheet rather than by opening the time
 * picker over it: React Native's modals do not stack gracefully, and a sheet
 * that dismissed itself to ask a question and then came back would lose the
 * user's place twice. Choosing a time swaps this sheet's body instead.
 */
export const QuietHoursSheet = memo(
  ({ visible, value, onChange, onClose }: Props) => {
    const { colors } = useTheme();
    /** Which end is being edited, or null while the summary is showing. */
    const [editing, setEditing] = useState<'start' | 'end' | null>(null);
    const [draft, setDraft] = useState<Parts>(() => fromTime(value.start));

    // Back to the summary each time it opens, so a sheet dismissed mid-edit
    // does not reopen inside a picker with no context.
    useEffect(() => {
      if (visible) {
        setEditing(null);
      }
    }, [visible]);

    const editStart = useCallback(() => {
      setDraft(fromTime(value.start));
      setEditing('start');
    }, [value.start]);

    const editEnd = useCallback(() => {
      setDraft(fromTime(value.end));
      setEditing('end');
    }, [value.end]);

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
      if (editing === null) {
        return;
      }
      onChange({ [editing]: toTime(draft) });
      setEditing(null);
    }, [draft, editing, onChange]);

    const toggle = useCallback(
      (enabled: boolean) => onChange({ enabled }),
      [onChange],
    );

    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        title={editing === null ? 'Quiet hours' : `Quiet hours ${editing}`}
      >
        {editing === null ? (
          <VStack gap="base" pb="base">
            <HStack align="center" gap="md">
              <VStack flex={1} gap="xxs">
                <AppText variant="bodyStrong">Silence notifications</AppText>
                <AppText variant="micro" color="textSecondary">
                  Nothing arrives inside the window. Alarms and reminders you
                  set yourself are unaffected.
                </AppText>
              </VStack>

              <RNSwitch
                value={value.enabled}
                onValueChange={toggle}
                trackColor={{
                  false: colors.switchBackground,
                  true: colors.brandAccent,
                }}
                thumbColor={colors.card}
                accessibilityRole="switch"
                accessibilityLabel="Quiet hours"
                accessibilityState={{ checked: value.enabled }}
              />
            </HStack>

            <Divider />

            <Pressable
              onPress={editStart}
              feedback="highlight"
              accessibilityRole="button"
              accessibilityLabel={`Start, ${formatTimeOfDay(value.start)}`}
            >
              <HStack align="center" justify="between" py="md">
                <AppText variant="bodyStrong">Start</AppText>
                <AppText variant="body" color="textSecondary">
                  {formatTimeOfDay(value.start)}
                </AppText>
              </HStack>
            </Pressable>

            <Divider />

            <Pressable
              onPress={editEnd}
              feedback="highlight"
              accessibilityRole="button"
              accessibilityLabel={`End, ${formatTimeOfDay(value.end)}`}
            >
              <HStack align="center" justify="between" py="md">
                <AppText variant="bodyStrong">End</AppText>
                <AppText variant="body" color="textSecondary">
                  {formatTimeOfDay(value.end)}
                </AppText>
              </HStack>
            </Pressable>
          </VStack>
        ) : (
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

            <Button label="Set time" size="lg" fullWidth onPress={confirm} />
          </VStack>
        )}
      </BottomSheet>
    );
  },
);

QuietHoursSheet.displayName = 'QuietHoursSheet';
