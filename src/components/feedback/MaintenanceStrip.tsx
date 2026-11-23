import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wrench } from 'lucide-react-native';
import { spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';

/**
 * Says maintenance is on, to the people it does not stop (RULES DV14).
 *
 * Testers and staff use the app through maintenance as if nothing were
 * happening — which is exactly how somebody forgets it is on, or tells a
 * member "it works for me". So for as long as it lasts, a strip sits above
 * the app saying so. It takes its own room under the status bar rather than
 * floating over a screen: maintenance can last an hour, and a header hidden
 * for an hour is a broken app, not an indicator.
 *
 * `sign-in` is the same strip on the sign-in screens reached through "Team
 * sign-in", before anybody knows whether this is a tester.
 */
export const MaintenanceStrip = memo(
  ({ mode }: { mode: 'bypass' | 'sign-in' }) => {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();

    return (
      <View
        style={[
          styles.strip,
          {
            paddingTop: insets.top + spacing.xs,
            backgroundColor: colors.warning,
          },
        ]}
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        testID="maintenance-strip"
      >
        <Icon as={Wrench} size="sm" tint={colors.primaryForeground} />
        <AppText
          variant="caption"
          style={{ color: colors.primaryForeground }}
          numberOfLines={1}
        >
          {mode === 'bypass'
            ? 'Maintenance mode · members see the maintenance screen'
            : 'Maintenance mode · team sign-in only'}
        </AppText>
      </View>
    );
  },
);

MaintenanceStrip.displayName = 'MaintenanceStrip';

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.base,
  },
});
