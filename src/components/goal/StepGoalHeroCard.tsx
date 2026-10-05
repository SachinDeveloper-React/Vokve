import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Polygon, Rect } from 'react-native-svg';
import { fontWeight, radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';

const ART_WIDTH = moderateScale(100);
const ART_HEIGHT = moderateScale(66);

/**
 * Two ramps climbing to the right and the dashes of a path behind them —
 * the design's picture of a step up. Drawn rather than shipped as an image,
 * so it takes the theme's accent.
 */
const StepsArt = ({ tint, dash }: { tint: string; dash: string }) => (
  <View
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
  >
    <Svg width={ART_WIDTH} height={ART_HEIGHT} viewBox="0 0 100 66">
      <Polygon points="12,40 48,40 48,5" fill={tint} />
      <Polygon points="61,62 93,62 93,28" fill={tint} />
      <Rect x={7} y={57} width={13} height={2.5} rx={1} fill={dash} />
      <Rect x={29} y={57} width={13} height={2.5} rx={1} fill={dash} />
    </Svg>
  </View>
);

/**
 * The screen's hero: why a goal, before the numbers. On the dark hero
 * panel the profile and the shop use — dark in both themes, so the art's
 * accent reads the same either way.
 */
export const StepGoalHeroCard = memo(() => {
  const { colors } = useTheme();
  const foreground = colors.tierForeground;

  return (
    <LinearGradient
      colors={colors.gradient.hero}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.panel}
    >
      <HStack align="center" gap="base">
        <VStack flex={1} gap="xs">
          {/* Broken where the design breaks it, rather than wherever the
              width runs out. */}
          <AppText variant="h2" style={[styles.title, { color: foreground }]}>
            {'A healthier you\nis a step closer!'}
          </AppText>
          <AppText
            variant="caption"
            style={{ color: withAlpha(foreground, 0.7) }}
          >
            Set a realistic goal and stay consistent.
          </AppText>
        </VStack>

        <StepsArt tint={colors.brandAccent} dash={foreground} />
      </HStack>
    </LinearGradient>
  );
});

StepGoalHeroCard.displayName = 'StepGoalHeroCard';

/** `Box` has no gradient, so the panel's rounding and padding go on the gradient itself. */
const styles = StyleSheet.create({
  panel: { borderRadius: radius.xl, padding: spacing.lg },
  title: { fontWeight: fontWeight.bold },
});
