import React, { memo, useMemo } from 'react';
import { useResponsive } from '../../hooks/useResponsive';
import { moderateScale } from '../../theme/responsive';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { HStack, VStack } from '../layout/Stack';
import { Pressable } from '../form/Pressable';
import { HydrationGlasses } from './HydrationGlasses';
import { HydrationQuickAdd } from './HydrationQuickAdd';
import { WaterDroplet } from './WaterDroplet';

/** One glass in the indicator row, in millilitres. */
const GLASS_ML = 250;
/** Beyond this the row of glasses stops being countable at a glance. */
const MAX_GLASSES = 10;

interface Props {
  consumedMl: number;
  goalMl: number;
  onAdd: (ml: number) => void;
  onPressDetails?: () => void;
  /** Quick-add amounts, in millilitres. */
  increments?: number[];
}

const litres = (ml: number) => (ml / 1000).toFixed(1);

/**
 * Water intake for the day.
 *
 * Three sizes carry the whole card and nothing else does: the litres are the
 * only large number, the percentage sits one step down because it is derived
 * from that number rather than being a second headline, and every label —
 * "HYDRATION", "/ 2.5 L", the quick-add amounts — is small. Colour is used the
 * same way: the accent marks what belongs to the reading of intake, so the
 * goal stays tertiary and does not compete with the figure it qualifies.
 *
 * Details open from the figures themselves rather than from a chevron, which
 * would be a third thing to press in a row that already has two. The target
 * deliberately stops short of the card: React Native's `Pressable` marks its
 * whole subtree as one accessibility element, so a card-wide press would fold
 * the two quick-adds into it and leave a screen reader no way to reach them.
 */
export const HydrationCard = memo(
  ({
    consumedMl,
    goalMl,
    onAdd,
    onPressDetails,
    increments = [200, 500],
  }: Props) => {
    const { width } = useResponsive();
    const isNarrow = width < 360;

    const { percent, filled, total } = useMemo(() => {
      const safeGoal = Math.max(1, goalMl);
      const glasses = Math.min(
        MAX_GLASSES,
        Math.max(1, Math.round(safeGoal / GLASS_ML)),
      );
      const perGlass = safeGoal / glasses;

      return {
        percent: Math.round((consumedMl / safeGoal) * 100),
        filled: Math.min(glasses, Math.floor(consumedMl / perGlass)),
        total: glasses,
      };
    }, [consumedMl, goalMl]);

    /** The figures and their second reading — one block, one press. */
    const readout = (
      <VStack gap="sm">
        {/* Baseline-aligned, which is what sets "/ 2.5 L" on the same line as
            the figure it divides instead of centring it against a much taller
            glyph. */}
        <HStack align="baseline" gap="base" wrap>
          <HStack align="baseline" gap="xs">
            <AppText variant="metric" color="primary">
              {litres(consumedMl)}
            </AppText>
            <AppText variant="body" color="textTertiary">
              {`/ ${litres(goalMl)} L`}
            </AppText>
          </HStack>

          <AppText variant="bodyStrong" color="primary">
            {`${percent}%`}
          </AppText>
        </HStack>

        <HydrationGlasses filled={filled} total={total} />
      </VStack>
    );

    return (
      <Card elevation="low" radius="xl" padding={isNarrow ? 'base' : 'lg'}>
        <HStack align="center" gap="base">
          <WaterDroplet size={moderateScale(isNarrow ? 44 : 52)} />

          <VStack flex={1} gap="sm">
            <HStack align="center" justify="between" gap="sm">
              <AppText variant="label" color="primary">
                Hydration
              </AppText>

              <HStack align="center" gap="base">
                {increments.map(ml => (
                  <HydrationQuickAdd key={ml} ml={ml} onPress={onAdd} />
                ))}
              </HStack>
            </HStack>

            {onPressDetails ? (
              <Pressable
                onPress={onPressDetails}
                feedback="opacity"
                accessibilityRole="button"
                // The readout's own text is inside this element, so the label
                // has to repeat the figures a screen reader can no longer see.
                accessibilityLabel={`Hydration, ${litres(
                  consumedMl,
                )} of ${litres(
                  goalMl,
                )} litres, ${percent} percent, ${filled} of ${total} glasses. Opens details.`}
              >
                {readout}
              </Pressable>
            ) : (
              readout
            )}
          </VStack>
        </HStack>
      </Card>
    );
  },
);

HydrationCard.displayName = 'HydrationCard';
