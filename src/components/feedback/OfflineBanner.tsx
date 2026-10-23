import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { CloudOff } from 'lucide-react-native';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { duration as durations, spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';

/**
 * A persistent strip under the status bar while the device cannot reach the
 * network.
 *
 * Deliberately not a toast: being offline is a lasting condition, not an
 * event, and a workout logged in a basement gym needs the user to understand
 * that their sets are saved locally and will sync later — not to see a message
 * disappear after three seconds.
 *
 * It says both halves of what offline means here, because both are true and
 * each is the answer to a different worry. **What is shown** is the last
 * figures the server sent, kept past the end of the process so the app opens
 * on numbers rather than on "Couldn't load" (`useServerRead`); a panel can
 * date its own with `StaleFigures`. **What is logged** — a drink, a meal, a
 * reading, a walk — is queued on the phone and goes when the network comes
 * back. Neither is lost, and a user who thinks either one is will stop using
 * the app in the one place it is most useful.
 */
export const OfflineBanner = memo(() => {
  const { isOffline } = useNetworkStatus();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(isOffline ? 1 : 0, {
      duration: durations.normal,
    });
  }, [isOffline, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -40 }],
  }));

  if (!isOffline) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        animatedStyle,
        { paddingTop: insets.top + spacing.xs, backgroundColor: colors.warning },
      ]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <Icon as={CloudOff} size="sm" tint={colors.primaryForeground} />
        <AppText
          variant="caption"
          style={{ color: colors.primaryForeground }}
        >
          You are offline. Showing your last synced figures — anything you
          log is saved on this device.
        </AppText>
      </View>
    </Animated.View>
  );
});

OfflineBanner.displayName = 'OfflineBanner';

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.base,
    zIndex: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
