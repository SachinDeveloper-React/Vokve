import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Plus, Search } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Input, INPUT_MIN_HEIGHT } from '../form/Input';
import { Pressable } from '../form/Pressable';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onPressAddCustom: () => void;
}

/**
 * The search field, and the way out of it when the search finds nothing.
 *
 * "Add Custom" sits beside the field rather than under the empty results,
 * because the moment a user needs it is the moment they have typed something
 * the library does not have — and an empty list with no way forward is where
 * food logging is abandoned.
 */
export const FoodSearchRow = memo(
  ({ value, onChange, onPressAddCustom }: Props) => {
    const { colors, isDark } = useTheme();

    return (
      <HStack align="center" gap="sm">
        <Input
          value={value}
          onChangeText={onChange}
          placeholder="Search food to add"
          accessibilityLabel="Search food to add"
          leading={<Icon as={Search} size="sm" color="textTertiary" />}
          style={styles.field}
          returnKeyType="search"
        />

        <Pressable
          onPress={onPressAddCustom}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel="Add a custom food"
        >
          <HStack
            align="center"
            justify="center"
            gap="xs"
            style={[
              styles.button,
              {
                borderColor: colors.avatarPurple,
                backgroundColor: withAlpha(
                  colors.avatarPurple,
                  isDark ? 0.18 : 0.08,
                ),
              },
            ]}
          >
            <Icon as={Plus} size="sm" tint={colors.avatarPurple} />
            <AppText variant="bodyStrong" style={{ color: colors.avatarPurple }}>
              Add Custom
            </AppText>
          </HStack>
        </Pressable>
      </HStack>
    );
  },
);

FoodSearchRow.displayName = 'FoodSearchRow';

/**
 * The button is built to the field's own measurements — `INPUT_MIN_HEIGHT` and
 * the input's corner radius — rather than to its own padding. Two controls on
 * one row that differ by nine points of height and four of radius read as a
 * mistake, and only the field's height is fixed by something other than taste.
 */
const styles = StyleSheet.create({
  field: {  width: '100%' },
  button: {
    minHeight: INPUT_MIN_HEIGHT,
    paddingHorizontal: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
