import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { BatteryWarning } from 'lucide-react-native';
import type { BackgroundRisk } from '../../stores/stepsStore';
import { useTheme } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';

interface Props {
  risk: BackgroundRisk;
  /** "Xiaomi" — the phone's maker, as the OS names it. */
  manufacturer: string;
  onOpenSettings: () => void;
}

const MESSAGE: Record<BackgroundRisk, (maker: string) => string> = {
  stopped: maker =>
    `Your ${maker} phone has been stopping step counting in the background, so some steps may be missing. Allow Vokve to keep running and it will not happen again.`,
  battery: () =>
    'Battery optimisation can pause step counting while the app is closed. Turn it off for Vokve so no steps are missed.',
  autostart: maker =>
    `${maker} phones can close apps to save battery. Allow Vokve to run in the background so counting carries on.`,
};

/**
 * The one card that only some phones see. Stock Android keeps a foreground
 * service alive; several makers' skins do not, and without this a user on
 * one of them loses every step taken with the app closed and blames the app.
 *
 * Shown only while there is something to lift, and each tap opens one
 * settings screen — the next visit offers the next one.
 */
export const BackgroundCountingCard = memo(
  ({ risk, manufacturer, onOpenSettings }: Props) => {
    const { colors } = useTheme();
    const maker = manufacturer
      ? manufacturer.charAt(0).toUpperCase() + manufacturer.slice(1)
      : 'This';

    return (
      <Card radius="xl" padding="base">
        <VStack gap="md">
          <HStack align="center" gap="md">
            <IconBadge
              icon={BatteryWarning}
              tint={colors.warning}
              shape="rounded"
            />
            <AppText variant="bodyStrong" style={styles.title}>
              Keep counting in the background
            </AppText>
          </HStack>
          <AppText variant="caption" color="textSecondary">
            {MESSAGE[risk](maker)}
          </AppText>
          <Button
            label="Open settings"
            variant="brandOutline"
            size="sm"
            onPress={onOpenSettings}
          />
        </VStack>
      </Card>
    );
  },
);

BackgroundCountingCard.displayName = 'BackgroundCountingCard';

const styles = StyleSheet.create({
  title: { flexShrink: 1 },
});
