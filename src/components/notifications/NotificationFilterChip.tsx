import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { NotificationFilter } from '../../stores/notificationsStore';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

/** Wide enough for two digits and its own padding. */
const BADGE_SIZE = moderateScale(20);

interface Props {
  value: NotificationFilter;
  label: string;
  icon: LucideIcon;
  /** How many notifications the chip stands for, shown in its badge. */
  count: number;
  selected: boolean;
  onPress: (value: NotificationFilter) => void;
}

/**
 * One chip in the notification filter row: a glyph, a label and a count.
 *
 * The chosen chip inverts — the app's text colour becomes its background and
 * the card's colour becomes its text — rather than taking a tint. Four chips
 * sitting on a white card have no room for a wash subtle enough not to shout
 * and strong enough to see, and inversion reads at a glance in both themes
 * without either problem.
 *
 * The count keeps its own contrast on both states: the accent on the inverted
 * pill, a muted disc on the plain one. A badge that changed only its text
 * colour would disappear into whichever background it landed on.
 */
export const NotificationFilterChip = memo(
  ({ value, label, icon, count, selected, onPress }: Props) => {
    const { colors } = useTheme();
    const handlePress = useCallback(() => onPress(value), [onPress, value]);

    const foreground = selected ? colors.card : colors.text;

    return (
      <Pressable
        onPress={handlePress}
        feedback="opacity"
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${label}, ${count}`}
      >
        <HStack
          align="center"
          gap="sm"
          px="md"
          py="sm"
          style={[
            styles.chip,
            selected && { backgroundColor: colors.text },
          ]}
        >
          <Icon
            as={icon}
            size="sm"
            tint={selected ? colors.card : colors.textSecondary}
          />

          <AppText variant="micro" style={[styles.label, { color: foreground }]}>
            {label}
          </AppText>

          <View
            // The number is already in the chip's accessibility label; read
            // out again here it would announce as a stray digit.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.badge,
              {
                backgroundColor: selected ? colors.brandAccent : colors.muted,
              },
            ]}
          >
            <AppText
              variant="miniMicro"
              style={[
                styles.badgeText,
                {
                  color: selected
                    ? colors.primaryForeground
                    : colors.textSecondary,
                },
              ]}
            >
              {count}
            </AppText>
          </View>
        </HStack>
      </Pressable>
    );
  },
);

NotificationFilterChip.displayName = 'NotificationFilterChip';

const styles = StyleSheet.create({
  chip: { borderRadius: radius.pill },
  label: { fontWeight: '600' },
  badge: {
    minWidth: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontWeight: '700' },
});
