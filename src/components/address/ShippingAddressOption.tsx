import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { PencilLine } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { Address } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';
import { formatAddressLines } from './AddressCard';

interface Props {
  address: Address;
  selected: boolean;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
}

const RADIO = 20;

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    card: {
      borderRadius: radius.lg,
      borderWidth: 1,
      paddingVertical: spacing.md,
      paddingLeft: spacing.md,
      paddingRight: spacing.sm,
    },
    radio: {
      width: RADIO,
      height: RADIO,
      borderRadius: RADIO / 2,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    dot: {
      width: RADIO / 2,
      height: RADIO / 2,
      borderRadius: RADIO / 4,
      backgroundColor: colors.brandAccent,
    },
    chip: {
      borderRadius: 999,
      paddingVertical: 2,
      paddingHorizontal: spacing.sm,
      backgroundColor: withAlpha(colors.brandAccent, 0.16),
    },
    chipText: { color: colors.brandAccent, fontWeight: '600' },
  });

/**
 * One saved address as a choice for this order: a radio, the label with
 * its "Default" chip, who it is for, the address as a courier reads it,
 * and a pencil to correct it. The chosen one is ringed in the brand
 * orange. Choosing is for this order only — the default stays the default.
 */
export const ShippingAddressOption = memo(
  ({ address, selected, onSelect, onEdit }: Props) => {
    const styles = useThemedStyles(makeStyles);
    const { colors, isDark } = useTheme();
    const select = useCallback(
      () => onSelect(address.id),
      [address.id, onSelect],
    );
    const edit = useCallback(() => onEdit(address.id), [address.id, onEdit]);
    const lines = formatAddressLines(address);

    return (
      <Pressable
        onPress={select}
        feedback="opacity"
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${address.label}${
          address.isDefault ? ', default' : ''
        }, ${address.name}, ${lines.join(', ')}`}
      >
        <HStack
          align="start"
          gap="md"
          style={[
            styles.card,
            selected
              ? {
                  borderColor: colors.brandAccent,
                  backgroundColor: withAlpha(
                    colors.brandAccent,
                    isDark ? 0.12 : 0.06,
                  ),
                }
              : { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <View
            style={[
              styles.radio,
              {
                borderColor: selected
                  ? colors.brandAccent
                  : colors.textTertiary,
              },
            ]}
          >
            {selected ? <View style={styles.dot} /> : null}
          </View>

          <VStack flex={1} gap="xxs">
            <HStack align="center" gap="sm" wrap>
              <AppText variant="h3">{address.label}</AppText>
              {address.isDefault ? (
                <View style={styles.chip}>
                  <AppText variant="micro" style={styles.chipText}>
                    Default
                  </AppText>
                </View>
              ) : null}
            </HStack>
            <AppText variant="bodyStrong">{address.name}</AppText>
            {lines.map(line => (
              <AppText key={line} variant="caption" color="textSecondary">
                {line}
              </AppText>
            ))}
          </VStack>

          <Pressable
            onPress={edit}
            feedback="opacity"
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${address.label}`}
          >
            <Icon as={PencilLine} size="sm" color="textSecondary" />
          </Pressable>
        </HStack>
      </Pressable>
    );
  },
);

ShippingAddressOption.displayName = 'ShippingAddressOption';
