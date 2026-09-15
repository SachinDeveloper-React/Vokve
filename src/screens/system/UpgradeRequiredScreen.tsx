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
 * The server has retired this build (426). Every request would fail the same
 * way, so the root navigator shows this instead of the app and there is no
 * way past it but the store — which is the point: a build the server has
 * blocked is one it no longer trusts.
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
            Update VOKVE to continue
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
          label="Open the store"
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
