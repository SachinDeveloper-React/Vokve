import React, { memo, useCallback } from 'react';
import { StyleSheet, Switch as RNSwitch, View } from 'react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import type { NotificationCategoryKey } from '../../stores/notificationSettingsStore';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { CATEGORY_STYLE } from './notificationCategories';

const DISC = moderateScale(34);

interface Props {
  category: NotificationCategoryKey;
  enabled: boolean;
  onChange: (category: NotificationCategoryKey, value: boolean) => void;
}

/**
 * One thing the app may tell the user about.
 *
 * The description is not decoration: it is the difference between a user
 * switching off "Challenges" and a user switching off the reminder that the
 * challenge they entered starts tomorrow. Every row carries one, and the
 * switch reads it out as part of its own label.
 */
export const NotificationCategoryRow = memo(
  ({ category, enabled, onChange }: Props) => {
    const { colors, isDark } = useTheme();
    const { title, description, tint } = CATEGORY_STYLE[category];
    const color = colors[tint];

    const handleChange = useCallback(
      (value: boolean) => onChange(category, value),
      [category, onChange],
    );

    return (
      <HStack align="center" gap="md" py="md">
        <View
          style={[
            styles.disc,
            { backgroundColor: withAlpha(color, isDark ? 0.24 : 0.14) },
          ]}
        >
          <View style={[styles.dot, { backgroundColor: color }]} />
        </View>

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="miniMicro" color="textSecondary" numberOfLines={2}>
            {description}
          </AppText>
        </VStack>

        <RNSwitch
          value={enabled}
          onValueChange={handleChange}
          trackColor={{
            false: colors.switchBackground,
            true: colors.brandAccent,
          }}
          thumbColor={colors.card}
          accessibilityRole="switch"
          accessibilityLabel={`${title}. ${description}`}
          accessibilityState={{ checked: enabled }}
        />
      </HStack>
    );
  },
);

NotificationCategoryRow.displayName = 'NotificationCategoryRow';

const styles = StyleSheet.create({
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: DISC / 3, height: DISC / 3, borderRadius: DISC / 6 },
});
