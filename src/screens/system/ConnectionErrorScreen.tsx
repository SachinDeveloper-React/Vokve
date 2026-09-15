import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { CloudOff, LogOut, RefreshCw } from 'lucide-react-native';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { Icon } from '../../components/media/Icon';
import { Wordmark } from '../../components/brand/Wordmark';
import { VStack } from '../../components/layout/Stack';
import { useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { useNetworkStatus } from '../../hooks';

const styles = StyleSheet.create({
  tagline: { letterSpacing: 2.4 },
  body: { maxWidth: 320 },
});

/**
 * Shown when a session exists but could not be confirmed at launch — the
 * server was unreachable, timed out, or answered 5xx.
 *
 * Not the sign-in screen: the user did nothing wrong and their session is
 * intact. Not the app either: there is no user record to draw it with, and
 * guessing one would send them through onboarding. So: what happened, in the
 * server's own words when it had any, and the two honest ways out.
 */
export const ConnectionErrorScreen = () => {
  const { colors } = useTheme();
  const error = useAuthStore(s => s.error);
  const isRetrying = useAuthStore(s => s.isSubmitting);
  const hydrate = useAuthStore(s => s.hydrate);
  const signOut = useAuthStore(s => s.signOut);
  const { isOffline } = useNetworkStatus();

  const retry = useCallback(() => {
    hydrate();
  }, [hydrate]);

  const title = isOffline ? "You're offline" : "Couldn't reach VOKVE";
  const message = isOffline
    ? 'Your session is safe. Reconnect to the internet and try again.'
    : error?.message ??
      'Something is wrong on our side. Your session is safe — try again in a moment.';

  return (
    <Screen edges={['top', 'bottom']}>
      <VStack flex={1} align="center" justify="center" gap="lg" px="lg">
        <VStack align="center" gap="xs">
          <Wordmark size="lg" />
          <AppText variant="label" color="textSecondary" style={styles.tagline}>
            Move • Earn • Achieve
          </AppText>
        </VStack>

        <Icon as={CloudOff} size="xl" tint={colors.textTertiary} />

        <VStack align="center" gap="xs" style={styles.body}>
          <AppText variant="h2" center>
            {title}
          </AppText>
          <AppText variant="body" color="textSecondary" center>
            {message}
          </AppText>
        </VStack>

        <VStack gap="sm" style={styles.body}>
          <Button
            label={isRetrying ? 'Retrying…' : 'Try again'}
            variant="brand"
            size="lg"
            fullWidth
            loading={isRetrying}
            disabled={isRetrying}
            onPress={retry}
            icon={<Icon as={RefreshCw} size="md" tint={colors.primaryForeground} />}
          />
          <Button
            label="Sign out"
            variant="ghost"
            fullWidth
            disabled={isRetrying}
            onPress={signOut}
            icon={<Icon as={LogOut} size="md" color="textSecondary" />}
          />
        </VStack>
      </VStack>
    </Screen>
  );
};
