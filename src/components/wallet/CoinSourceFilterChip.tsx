import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import type { CoinSource } from '../../types/models';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

/** `null` is the chip that shows everything. */
export type CoinSourceFilter = CoinSource | null;

interface Props {
  value: CoinSourceFilter;
  label: string;
  icon: LucideIcon;
  selected: boolean;
  onPress: (value: CoinSourceFilter) => void;
}

/**
 * One chip in the coin history's filter row: a glyph and a label.
 *
 * The same inversion as the notification centre's chips — the app's text
 * colour becomes the chosen chip's background — and for the same reason: a
 * row of chips on a card has no room for a wash that is both quiet and
 * visible, and inversion is neither. No count badge, though: the server pages
 * the ledger, so the app never knows how many rows a source has.
 */
export const CoinSourceFilterChip = memo(
  ({ value, label, icon, selected, onPress }: Props) => {
    const { colors } = useTheme();
    const handlePress = useCallback(() => onPress(value), [onPress, value]);

    return (
      <Pressable
        onPress={handlePress}
        feedback="opacity"
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
      >
        <HStack
          align="center"
          gap="xs"
          px="md"
          py="sm"
          style={[styles.chip, selected && { backgroundColor: colors.text }]}
        >
          <Icon
            as={icon}
            size="sm"
            tint={selected ? colors.card : colors.textSecondary}
          />
          <AppText
            variant="micro"
            style={[
              styles.label,
              { color: selected ? colors.card : colors.text },
            ]}
          >
            {label}
          </AppText>
        </HStack>
      </Pressable>
    );
  },
);

CoinSourceFilterChip.displayName = 'CoinSourceFilterChip';

const styles = StyleSheet.create({
  chip: { borderRadius: radius.pill },
  label: { fontWeight: '600' },
});
