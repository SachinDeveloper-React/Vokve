import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { radius, useTheme } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  sizes: readonly string[];
  value: string | null;
  onChange: (size: string) => void;
  /** Shown under the label while nothing is picked and the user has tried to go on. */
  error?: string | null;
}

/**
 * The sizes an item comes in, one tappable square each. Nothing is picked
 * to begin with: a default of "M" would be right for some and quietly
 * wrong for the rest, and a wrong size is the return nobody wants.
 */
export const SizePicker = memo(
  ({ sizes, value, onChange, error = null }: Props) => {
    const { colors } = useTheme();
    return (
      <VStack gap="sm">
        <HStack align="center" justify="between">
          <AppText variant="label" color="textSecondary">
            Size
          </AppText>
          {value ? (
            <AppText
              variant="micro"
              color="textTertiary"
            >{`Selected: ${value}`}</AppText>
          ) : null}
        </HStack>
        <HStack gap="sm" wrap>
          {sizes.map(size => {
            const selected = size === value;
            return (
              <Pressable
                key={size}
                onPress={() => onChange(size)}
                feedback="scale"
                accessibilityRole="button"
                accessibilityLabel={`Size ${size}`}
                accessibilityState={{ selected }}
                style={[
                  styles.square,
                  {
                    backgroundColor: selected ? colors.text : colors.card,
                    borderColor: selected
                      ? colors.text
                      : error
                      ? colors.destructive
                      : colors.border,
                  },
                ]}
              >
                <AppText
                  variant="bodyStrong"
                  style={{ color: selected ? colors.card : colors.text }}
                >
                  {size}
                </AppText>
              </Pressable>
            );
          })}
        </HStack>
        {error ? (
          <AppText variant="micro" color="destructive">
            {error}
          </AppText>
        ) : null}
      </VStack>
    );
  },
);

SizePicker.displayName = 'SizePicker';

const styles = StyleSheet.create({
  square: {
    minWidth: 48,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
