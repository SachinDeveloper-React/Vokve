import React, { memo, useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheet } from '../disclosure/BottomSheet';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Input } from '../form/Input';

const MAX_CALORIES = 3000;
const MAX_GRAMS = 500;

function parse(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export interface CustomFood {
  name: string;
  portion: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
  fiberG: number;
}

interface Props {
  visible: boolean;
  /** Pre-fills the name from whatever the search could not find. */
  initialName?: string;
  onSubmit: (food: CustomFood) => void;
  onClose: () => void;
}

/**
 * A food the library does not carry.
 *
 * Only the name and the calories are required. The macros are what the bars on
 * the nutrition screen are drawn from, so they are worth asking for — but a
 * sheet that refused to log a home-cooked sabzi without four figures is a
 * sheet that teaches people to stop logging home cooking.
 */
export const CustomFoodSheet = memo(
  ({ visible, initialName = '', onSubmit, onClose }: Props) => {
    const [name, setName] = useState(initialName);
    const [portion, setPortion] = useState('');
    const [calories, setCalories] = useState('');
    const [protein, setProtein] = useState('');
    const [carbs, setCarbs] = useState('');
    const [fats, setFats] = useState('');
    const [fiber, setFiber] = useState('');

    // Re-seeded each time it opens, so the search's term arrives in the field
    // and yesterday's abandoned entry does not.
    useEffect(() => {
      if (visible) {
        setName(initialName);
        setPortion('');
        setCalories('');
        setProtein('');
        setCarbs('');
        setFats('');
        setFiber('');
      }
    }, [initialName, visible]);

    const kcal = parse(calories);
    const isValid = name.trim().length > 0 && kcal > 0 && kcal <= MAX_CALORIES;

    const handleSubmit = useCallback(() => {
      if (!isValid) {
        return;
      }

      onSubmit({
        name: name.trim(),
        portion: portion.trim(),
        calories: kcal,
        proteinG: Math.min(MAX_GRAMS, parse(protein)),
        carbsG: Math.min(MAX_GRAMS, parse(carbs)),
        fatsG: Math.min(MAX_GRAMS, parse(fats)),
        fiberG: Math.min(MAX_GRAMS, parse(fiber)),
      });
      onClose();
    }, [carbs, fats, fiber, isValid, kcal, name, onClose, onSubmit, portion, protein]);

    return (
      <BottomSheet visible={visible} onClose={onClose} title="Custom food">
        <VStack gap="base" pb="base">
          <Input
            label="Food"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Paneer bhurji"
            returnKeyType="next"
          />

          <Input
            label="Portion"
            value={portion}
            onChangeText={setPortion}
            placeholder="1 bowl (150 g)"
            helper="Optional, but it is what the figures describe"
            returnKeyType="next"
          />

          <Input
            label="Calories"
            value={calories}
            onChangeText={setCalories}
            keyboardType="number-pad"
            placeholder="150"
            helper={`Up to ${MAX_CALORIES} kcal`}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          <VStack gap="xs">
            <AppText variant="micro" color="textSecondary">
              Macros, if you know them
            </AppText>

            <HStack align="start" gap="sm">
              <Input
                label="Carbs"
                value={carbs}
                onChangeText={setCarbs}
                keyboardType="decimal-pad"
                placeholder="g"
                style={styles.field}
              />
              <Input
                label="Protein"
                value={protein}
                onChangeText={setProtein}
                keyboardType="decimal-pad"
                placeholder="g"
                style={styles.field}
              />
              <Input
                label="Fat"
                value={fats}
                onChangeText={setFats}
                keyboardType="decimal-pad"
                placeholder="g"
                style={styles.field}
              />
              <Input
                label="Fiber"
                value={fiber}
                onChangeText={setFiber}
                keyboardType="decimal-pad"
                placeholder="g"
                style={styles.field}
              />
            </HStack>
          </VStack>

          <Button
            label="Add to meal"
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

CustomFoodSheet.displayName = 'CustomFoodSheet';

const styles = StyleSheet.create({
  field: { flex: 1 },
});
