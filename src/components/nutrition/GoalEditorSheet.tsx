import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { BottomSheet } from '../disclosure/BottomSheet';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Input } from '../form/Input';
import type { NutritionGoals } from '../../types/models';
import { formatGrouped } from '../../utils/format';

/** The bounds the server enforces (⚙ `nutrition`, RULES N4); said here so a refusal is rare. */
const BOUNDS = {
  calories: { min: 800, max: 6000 },
  proteinG: { min: 0, max: 400 },
  carbsG: { min: 0, max: 900 },
  fatsG: { min: 0, max: 300 },
} as const;

type Field = keyof typeof BOUNDS;

const FIELDS: readonly { key: Field; label: string; suffix: string }[] = [
  { key: 'calories', label: 'Daily calories', suffix: 'kcal' },
  { key: 'proteinG', label: 'Protein', suffix: 'g' },
  { key: 'carbsG', label: 'Carbs', suffix: 'g' },
  { key: 'fatsG', label: 'Fats', suffix: 'g' },
];

/** 4 kcal per gram of protein and carbohydrate, 9 per gram of fat. */
const KCAL_PER_GRAM = { proteinG: 4, carbsG: 4, fatsG: 9 } as const;

const parse = (value: string): number => {
  const parsed = Number.parseInt(value.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const withinBounds = (key: Field, value: number) =>
  value >= BOUNDS[key].min && value <= BOUNDS[key].max;

interface Props {
  visible: boolean;
  /** The targets as they stand, which the fields open on. */
  goals: NutritionGoals;
  onSubmit: (goals: NutritionGoals) => void;
  onClose: () => void;
}

/**
 * The day's targets, edited by hand (RULES N4).
 *
 * Four plain fields rather than a calculator: the macros that follow from a
 * calorie target depend on a split the app has no business deciding for
 * somebody, and a sheet that recomputed protein every time the calories moved
 * would overwrite a figure the user had just typed.
 *
 * What it does say is what the macros come to in calories, because a protein,
 * carb and fat target that adds up to half the calorie goal is a mistake worth
 * noticing — and it is the user's to resolve, so it is stated and not enforced.
 */
export const GoalEditorSheet = memo(
  ({ visible, goals, onSubmit, onClose }: Props) => {
    const [values, setValues] = useState<Record<Field, string>>({
      calories: String(goals.calories),
      proteinG: String(goals.proteinG),
      carbsG: String(goals.carbsG),
      fatsG: String(goals.fatsG),
    });

    // Re-seeded each time it opens, so it shows what is in force rather than
    // an edit that was abandoned last time.
    useEffect(() => {
      if (visible) {
        setValues({
          calories: String(goals.calories),
          proteinG: String(goals.proteinG),
          carbsG: String(goals.carbsG),
          fatsG: String(goals.fatsG),
        });
      }
    }, [goals, visible]);

    const parsed = useMemo(
      () => ({
        calories: parse(values.calories),
        proteinG: parse(values.proteinG),
        carbsG: parse(values.carbsG),
        fatsG: parse(values.fatsG),
      }),
      [values],
    );

    const invalid = FIELDS.filter(field => !withinBounds(field.key, parsed[field.key]));
    const isValid = invalid.length === 0;

    const fromMacros =
      parsed.proteinG * KCAL_PER_GRAM.proteinG +
      parsed.carbsG * KCAL_PER_GRAM.carbsG +
      parsed.fatsG * KCAL_PER_GRAM.fatsG;
    const drift = fromMacros - parsed.calories;

    const setField = useCallback(
      (key: Field, next: string) =>
        setValues(current => ({ ...current, [key]: next })),
      [],
    );

    const handleSubmit = useCallback(() => {
      if (!isValid) {
        return;
      }
      onSubmit(parsed);
      onClose();
    }, [isValid, onClose, onSubmit, parsed]);

    return (
      <BottomSheet visible={visible} onClose={onClose} title="Daily goal">
        <VStack gap="base" pb="base">
          {FIELDS.map(field => (
            <Input
              key={field.key}
              label={`${field.label} (${field.suffix})`}
              value={values[field.key]}
              onChangeText={next => setField(field.key, next)}
              keyboardType="number-pad"
              helper={`${BOUNDS[field.key].min}–${BOUNDS[field.key].max} ${field.suffix}`}
              error={
                withinBounds(field.key, parsed[field.key])
                  ? undefined
                  : `Between ${BOUNDS[field.key].min} and ${BOUNDS[field.key].max}.`
              }
              returnKeyType={field.key === 'fatsG' ? 'done' : 'next'}
              onSubmitEditing={field.key === 'fatsG' ? handleSubmit : undefined}
            />
          ))}

          {/* Stated, not enforced: plenty of real plans do not add up exactly,
              and a sheet that refused to save until they did would be arguing
              with a dietitian it cannot see. */}
          <HStack align="center" gap="sm">
            <AppText variant="micro" color="textSecondary">
              Your macros come to
            </AppText>
            <AppText
              variant="micro"
              color={Math.abs(drift) > 150 ? 'warning' : 'textSecondary'}
            >
              {`${formatGrouped(fromMacros)} kcal`}
            </AppText>
            {Math.abs(drift) > 150 ? (
              <AppText variant="micro" color="warning">
                {drift > 0 ? '— above your calorie goal' : '— below your calorie goal'}
              </AppText>
            ) : null}
          </HStack>

          <Button
            label="Save goal"
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

GoalEditorSheet.displayName = 'GoalEditorSheet';
