import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Heart } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { pressureBandFor, pressureMessageFor } from '../health/vitals';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

const DISC = moderateScale(72);

interface FigureProps {
  label: string;
  value: string;
}

const Figure = memo(({ label, value }: FigureProps) => (
  <VStack
    flex={1}
    gap="xxs"
    accessible
    accessibilityLabel={`${label}, ${value}`}
  >
    <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
      {label}
    </AppText>
    <AppText variant="h3" numberOfLines={1}>
      {value}
    </AppText>
  </VStack>
));

Figure.displayName = 'Figure';

interface Props {
  systolic: number;
  diastolic: number;
  /** The latest pulse, shown beside the pressure. Null when none is logged. */
  pulse: number | null;
}

/**
 * The reading itself, and the three figures it is made of.
 *
 * The verdict is one word for both halves together, because that is how the
 * bands work: a diastolic of 82 makes the whole reading high, however ordinary
 * the 126 beside it. Stating a verdict per number would let the two disagree
 * on a card that exists to give one answer.
 *
 * The pulse sits beside the pressure because a cuff reports both at once and
 * a user comparing readings expects to see them together. It is the latest
 * pulse on record, not one taken with this reading — the app has no way to
 * pair the two yet, and says "PULSE" rather than pretending it did.
 */
export const BloodPressureHeroCard = memo(
  ({ systolic, diastolic, pulse }: Props) => {
    const { colors, isDark } = useTheme();
    const band = pressureBandFor(systolic, diastolic);

    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: withAlpha(colors.primary, isDark ? 0.14 : 0.07),
            borderColor: withAlpha(colors.primary, isDark ? 0.3 : 0.18),
          },
        ]}
      >
        <HStack align="center" gap="base">
          <View
            style={[
              styles.disc,
              { backgroundColor: withAlpha(colors.primary, 0.24) },
            ]}
          >
            <Icon as={Heart} size="xl" tint={colors.primary} />
          </View>

          <VStack flex={1} gap="xxs">
            <HStack align="baseline" gap="xs">
              <AppText variant="display" numberOfLines={1}>
                {`${Math.round(systolic)}/`}
              </AppText>
              <AppText variant="h1" numberOfLines={1}>
                {Math.round(diastolic)}
              </AppText>
              <AppText variant="micro" color="textSecondary">
                mmHg
              </AppText>
            </HStack>

            <AppText
              variant="h3"
              numberOfLines={1}
              style={{ color: colors[band.tint] }}
            >
              {band.label}
            </AppText>

            <AppText variant="micro" color="textSecondary" numberOfLines={2}>
              {pressureMessageFor(systolic, diastolic)}
            </AppText>
          </VStack>
        </HStack>

        <HStack align="start" gap="sm">
          <Figure label="SYS" value={String(Math.round(systolic))} />
          <Figure label="DIA" value={String(Math.round(diastolic))} />
          <Figure
            label="PULSE"
            value={pulse === null ? '—' : `${Math.round(pulse)} bpm`}
          />
        </HStack>
      </View>
    );
  },
);

BloodPressureHeroCard.displayName = 'BloodPressureHeroCard';

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
    gap: spacing.base,
  },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
