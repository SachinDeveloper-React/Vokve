import React, { useCallback } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { ArrowUpCircle } from 'lucide-react-native';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { Icon } from '../../components/media/Icon';
import { Wordmark } from '../../components/brand/Wordmark';
import { VStack } from '../../components/layout/Stack';
import { useTheme } from '../../theme';
import { config } from '../../constants/config';
import { useUpgradeRequired } from '../../stores/appStatusStore';
import { logger } from '../../utils/logger';

const styles = StyleSheet.create({
  tagline: { letterSpacing: 2.4 },
  body: { maxWidth: 320 },
});

/**
 * The wall (RULES DV12): this build is below the minimum or blocked
 * outright, so every request would fail the same way. The root navigator
 * shows this instead of the app and there is no way past it but the store —
 * which is the point: a build the server has blocked is one it no longer
 * trusts.
 *
 * It is drawn for either messenger: a request refused with 426, or
 * `GET /app/update` saying `hard` before anything was refused. The second is
 * what a member sees in practice, because it arrives on launch; the first is
 * the backstop for a wall put up mid-session.
 */
export const UpgradeRequiredScreen = () => {
  const { colors } = useTheme();
  const requirement = useUpgradeRequired();

  const openStore = useCallback(() => {
    const url = requirement?.storeUrl;
    if (!url) {
      return;
    }
    Linking.openURL(url).catch(error =>
      logger.warn('UpgradeRequiredScreen', 'Could not open the store', error),
    );
  }, [requirement]);

  return (
    <Screen edges={['top', 'bottom']}>
      <VStack flex={1} align="center" justify="center" gap="lg" px="lg">
        <VStack align="center" gap="xs">
          <Wordmark size="lg" />
          <AppText variant="label" color="textSecondary" style={styles.tagline}>
            Move • Earn • Achieve
          </AppText>
        </VStack>

        <Icon as={ArrowUpCircle} size="xl" tint={colors.brandAccent} />

        <VStack align="center" gap="xs" style={styles.body}>
          <AppText variant="h2" center>
            {requirement?.title ?? 'Update VOKVE to continue'}
          </AppText>
          <AppText variant="body" color="textSecondary" center>
            {requirement?.message ?? 'This version is no longer supported.'}
          </AppText>
          <AppText variant="caption" color="textTertiary" center>
            {`You have ${config.appVersion}${
              requirement?.minVersion ? ` · needs ${requirement.minVersion} or newer` : ''
            }`}
          </AppText>
        </VStack>

        <Button
          label={requirement?.actionLabel ?? 'Open the store'}
          variant="brand"
          size="lg"
          fullWidth
          disabled={!requirement?.storeUrl}
          onPress={openStore}
        />
      </VStack>
    </Screen>
  );
};
