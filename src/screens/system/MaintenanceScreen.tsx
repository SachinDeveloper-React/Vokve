import React, { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { LogIn, RefreshCw, Wrench } from 'lucide-react-native';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { Icon } from '../../components/media/Icon';
import { Wordmark } from '../../components/brand/Wordmark';
import { VStack } from '../../components/layout/Stack';
import { useTheme } from '../../theme';
import { checkMaintenance } from '../../hooks/useMaintenance';
import {
  useAppStatusStore,
  useMaintenanceWall,
  MAINTENANCE_DEFAULT_TITLE,
} from '../../stores/appStatusStore';
import { useAuthStatus } from '../../stores/authStore';
import { formatClockTime, formatDayMonthYear } from '../../utils/format';

const styles = StyleSheet.create({
  tagline: { letterSpacing: 2.4 },
  body: { maxWidth: 320 },
});

/** "3:30 PM" today, "3:30 PM, 24 Nov 2026" on another day; null for no time, or one already past. */
export function expectedBack(
  endsAt: string | null,
  now = new Date(),
): string | null {
  if (!endsAt) return null;
  const at = new Date(endsAt);
  if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return null;
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay
    ? formatClockTime(endsAt)
    : `${formatClockTime(endsAt)}, ${formatDayMonthYear(endsAt)}`;
}

/**
 * Maintenance (RULES DV14): the server is refusing members while the team
 * works on it, so the root navigator shows this instead of the app.
 *
 * Every word is the server's — the title and message are written on the
 * panel's Maintenance page, and so is the time it expects to be back. The
 * screen lifts by itself: the phone asks every half minute and on every
 * return to the foreground, and "Try again" asks at once.
 *
 * A phone that is signed out also gets "Team sign-in": testers and staff
 * carry on through maintenance, and the sign-in screens are how they get
 * in. Anybody else who signs in is back here on their first request.
 */
export const MaintenanceScreen = () => {
  const { colors } = useTheme();
  const maintenance = useMaintenanceWall();
  const authStatus = useAuthStatus();
  const setMaintenanceSignIn = useAppStatusStore(s => s.setMaintenanceSignIn);
  const [checking, setChecking] = useState(false);
  const [stillOn, setStillOn] = useState(false);

  const retry = useCallback(async () => {
    setChecking(true);
    await checkMaintenance();
    setChecking(false);
    // Still mounted means still in maintenance: say so, rather than a button
    // that seems to have done nothing.
    setStillOn(true);
  }, []);

  const back = expectedBack(maintenance?.endsAt ?? null);
  const signedOut = authStatus === 'signed_out';

  return (
    <Screen edges={['top', 'bottom']}>
      <VStack flex={1} align="center" justify="center" gap="lg" px="lg">
        <VStack align="center" gap="xs">
          <Wordmark size="lg" />
          <AppText variant="label" color="textSecondary" style={styles.tagline}>
            Move • Earn • Achieve
          </AppText>
        </VStack>

        <Icon as={Wrench} size="xl" tint={colors.brandAccent} />

        <VStack align="center" gap="xs" style={styles.body}>
          <AppText variant="h2" center>
            {maintenance?.title || MAINTENANCE_DEFAULT_TITLE}
          </AppText>
          {maintenance?.message ? (
            <AppText variant="body" color="textSecondary" center>
              {maintenance.message}
            </AppText>
          ) : null}
          {back ? (
            <AppText variant="bodyStrong" center>
              {`Expected back by ${back}`}
            </AppText>
          ) : null}
          <AppText variant="caption" color="textTertiary" center>
            {stillOn
              ? 'Still under maintenance. The app opens by itself the moment we are back.'
              : 'The app opens by itself the moment we are back.'}
          </AppText>
        </VStack>

        <VStack gap="sm" style={styles.body}>
          <Button
            label={checking ? 'Checking…' : 'Try again'}
            variant="brand"
            size="lg"
            fullWidth
            loading={checking}
            disabled={checking}
            onPress={retry}
            icon={
              <Icon as={RefreshCw} size="md" tint={colors.primaryForeground} />
            }
          />
          {signedOut ? (
            <Button
              label="Team sign-in"
              variant="ghost"
              fullWidth
              disabled={checking}
              onPress={() => setMaintenanceSignIn(true)}
              icon={<Icon as={LogIn} size="md" color="textSecondary" />}
            />
          ) : null}
        </VStack>
      </VStack>
    </Screen>
  );
};
