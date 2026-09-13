import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { radius, useTheme } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';

/** Which preference a tile edits, and what the sheet it opens is about. */
export type PreferenceKind = 'dietType' | 'mealPlan' | 'goal';

interface TileProps {
  kind: PreferenceKind;
  label: string;
  value: string;
  onPress: (kind: PreferenceKind) => void;
}

const PreferenceTile = memo(({ kind, label, value, onPress }: TileProps) => {
  const { colors } = useTheme();
  const press = useCallback(() => onPress(kind), [kind, onPress]);

  return (
    <Pressable
      onPress={press}
      feedback="opacity"
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}. Change`}
      style={styles.press}
    >
      <VStack
        flex={1}
        gap="xxs"
        p="md"
        style={[styles.tile, { borderColor: colors.border }]}
      >
        <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
          {label}
        </AppText>
        <AppText
          variant="bodyStrong"
          numberOfLines={1}
          style={{ color: colors.success }}
        >
          {value}
        </AppText>
        <AppText variant="miniMicro" color="primary" numberOfLines={1}>
          Change
        </AppText>
      </VStack>
    </Pressable>
  );
});

PreferenceTile.displayName = 'PreferenceTile';

interface Props {
  dietType: string;
  mealPlan: string;
  goal: string;
  onPressChange: (kind: PreferenceKind) => void;
  onPressManage: () => void;
}

/**
 * How the user eats, as three things they can change.
 *
 * Each tile is its own press target rather than the card being one: the three
 * open different pickers, and a single card-wide target would need the user to
 * guess which of the three they were about to edit.
 */
export const PreferencesCard = memo(
  ({ dietType, mealPlan, goal, onPressChange, onPressManage }: Props) => (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <HStack align="center" justify="between" gap="sm">
          <AppText variant="label" color="textSecondary" numberOfLines={1}>
            Meal Plan & Preferences
          </AppText>

          <Pressable
            onPress={onPressManage}
            feedback="opacity"
            accessibilityRole="link"
            accessibilityLabel="Manage meal plan and preferences"
          >
            <AppText variant="micro" color="primary">
              Manage
            </AppText>
          </Pressable>
        </HStack>

        <HStack align="stretch" gap="sm">
          <PreferenceTile
            kind="dietType"
            label="Diet Type"
            value={dietType}
            onPress={onPressChange}
          />
          <PreferenceTile
            kind="mealPlan"
            label="Meal Plan"
            value={mealPlan}
            onPress={onPressChange}
          />
          <PreferenceTile
            kind="goal"
            label="Goal"
            value={goal}
            onPress={onPressChange}
          />
        </HStack>
      </VStack>
    </Card>
  ),
);

PreferencesCard.displayName = 'PreferencesCard';

const styles = StyleSheet.create({
  press: { flex: 1 },
  tile: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
