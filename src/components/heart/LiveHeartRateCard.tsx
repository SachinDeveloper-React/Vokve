import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface Props {
  /** Whether a sensor is actually connected. Drives the pill and the button. */
  available: boolean;
  onPressMeasure: () => void;
}

/**
 * Taking a reading now.
 *
 * The pill says "Live" only when a sensor is actually connected. This build
 * has none — the health integration lands with the native side — so it reads
 * "Not connected" and the button logs a reading by hand instead. A card that
 * claimed to be live and then asked the user to type a number would be the
 * one lie on a screen of medical figures.
 */
export const LiveHeartRateCard = memo(
  ({ available, onPressMeasure }: Props) => {
    const { colors, isDark } = useTheme();
    const tint = available ? colors.success : colors.textSecondary;

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack align="center" justify="between" gap="sm">
            <VStack flex={1} gap="xxs">
              <AppText variant="h3" numberOfLines={1}>
                Live Heart Rate
              </AppText>
              <AppText variant="micro" color="textSecondary" numberOfLines={2}>
                {available
                  ? 'Real-time measurement using your device'
                  : 'No sensor connected yet — log a reading by hand'}
              </AppText>
            </VStack>

            <HStack
              align="center"
              gap="xs"
              px="md"
              py="xs"
              style={[
                styles.pill,
                { backgroundColor: withAlpha(tint, isDark ? 0.22 : 0.12) },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: tint }]} />
              <AppText variant="miniMicro" style={{ color: tint }}>
                {available ? 'Live' : 'Not connected'}
              </AppText>
            </HStack>
          </HStack>

          <Button
            label={available ? 'Start Measuring' : 'Log a reading'}
            icon={<Icon as={Sparkles} size="sm" color="primaryForeground" />}
            size="lg"
            fullWidth
            onPress={onPressMeasure}
          />
        </VStack>
      </Card>
    );
  },
);

LiveHeartRateCard.displayName = 'LiveHeartRateCard';

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
