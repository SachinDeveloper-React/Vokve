import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import type { VitalKind } from '../../types/models';
import { BottomSheet } from '../disclosure/BottomSheet';
import { HStack, VStack } from '../layout/Stack';
import { Button } from '../ui/Button';
import { Input } from '../form/Input';
import { RadioGroup, type RadioOption } from '../form/Radio';
import { VITAL_ORDER, VITAL_STYLE } from './vitals';

/**
 * What each reading may plausibly be, so a slipped decimal point cannot be
 * logged as a pulse of 720. Deliberately wide: these are sanity bounds, not
 * medical advice, and a genuinely alarming reading still has to be loggable.
 */
const BOUNDS: Record<VitalKind, { min: number; max: number }> = {
  heart_rate: { min: 30, max: 220 },
  blood_pressure: { min: 60, max: 250 },
  bmi: { min: 10, max: 60 },
  weight: { min: 20, max: 350 },
};

/** The diastolic half has its own, lower, range. */
const DIASTOLIC = { min: 30, max: 150 };

const OPTIONS: RadioOption<VitalKind>[] = VITAL_ORDER.map(kind => ({
  value: kind,
  label: VITAL_STYLE[kind].label,
  helper: VITAL_STYLE[kind].unit || undefined,
}));

function parse(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inRange(
  value: number | null,
  { min, max }: { min: number; max: number },
) {
  return value !== null && value >= min && value <= max;
}

interface Props {
  visible: boolean;
  /**
   * Locks the sheet to one vital and drops the picker.
   *
   * A screen about a single reading has already asked the question the radio
   * group asks, and answering it twice is how a user ends up logging a pulse
   * as a weight.
   */
  kind?: VitalKind;
  onSubmit: (kind: VitalKind, value: number, secondary: number | null) => void;
  onClose: () => void;
}

/**
 * The sheet behind "Add New Reading".
 *
 * One sheet for all four vitals rather than a control per tile: a reading is
 * logged rarely and deliberately, and four separate entry points would each
 * be found a quarter as often as this one.
 *
 * The second field appears only for blood pressure, which is the one reading
 * that is two numbers. A permanently visible field that is blank three times
 * out of four reads as something the user forgot to fill in.
 */
export const AddReadingSheet = memo(
  ({ visible, kind: locked, onSubmit, onClose }: Props) => {
    const [kind, setKind] = useState<VitalKind>(locked ?? 'heart_rate');
    const [primary, setPrimary] = useState('');
    const [secondary, setSecondary] = useState('');

    // Cleared each time the sheet opens, so a reading abandoned yesterday is not
    // waiting in the field this morning.
    useEffect(() => {
      if (visible) {
        setKind(locked ?? 'heart_rate');
        setPrimary('');
        setSecondary('');
      }
    }, [locked, visible]);

    const isPressure = kind === 'blood_pressure';
    const primaryValue = parse(primary);
    const secondaryValue = parse(secondary);

    const isValid = useMemo(() => {
      if (!inRange(primaryValue, BOUNDS[kind])) {
        return false;
      }
      return !isPressure || inRange(secondaryValue, DIASTOLIC);
    }, [isPressure, kind, primaryValue, secondaryValue]);

    const handleSubmit = useCallback(() => {
      if (!isValid || primaryValue === null) {
        return;
      }
      onSubmit(kind, primaryValue, isPressure ? secondaryValue : null);
      onClose();
    }, [
      isPressure,
      isValid,
      kind,
      onClose,
      onSubmit,
      primaryValue,
      secondaryValue,
    ]);

    const { unit, label } = VITAL_STYLE[kind];

    return (
      <BottomSheet visible={visible} onClose={onClose} title="Add a reading">
        <VStack gap="base" pb="base">
          {locked === undefined ? (
            <RadioGroup
              label="What are you logging?"
              options={OPTIONS}
              value={kind}
              onChange={setKind}
            />
          ) : null}

          <HStack align="start" gap="sm">
            <Input
              label={isPressure ? 'Systolic' : label}
              value={primary}
              onChangeText={setPrimary}
              keyboardType="decimal-pad"
              placeholder={isPressure ? '118' : ''}
              helper={`${BOUNDS[kind].min}–${BOUNDS[kind].max}${
                unit ? ` ${unit}` : ''
              }`}
              style={styles.field}
              returnKeyType={isPressure ? 'next' : 'done'}
              onSubmitEditing={isPressure ? undefined : handleSubmit}
            />

            {isPressure ? (
              <Input
                label="Diastolic"
                value={secondary}
                onChangeText={setSecondary}
                keyboardType="decimal-pad"
                placeholder="76"
                helper={`${DIASTOLIC.min}–${DIASTOLIC.max} mmHg`}
                style={styles.field}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            ) : null}
          </HStack>

          <Button
            label="Save reading"
            size="lg"
            fullWidth
            disabled={!isValid}
            onPress={handleSubmit}
          />
        </VStack>
      </BottomSheet>
    );
  },
);

AddReadingSheet.displayName = 'AddReadingSheet';

/** The two pressure fields share the row, so each takes half of it. */
const styles = StyleSheet.create({
  field: { flex: 1 },
});
