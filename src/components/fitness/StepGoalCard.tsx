import React, { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Flag, Footprints, Pencil } from 'lucide-react-native';
import { useResponsive } from '../../hooks/useResponsive';
import { useTheme } from '../../theme';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Icon } from '../media/Icon';
import { Box } from '../layout/Box';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Pressable } from '../form/Pressable';
import { ProgressRing } from './ProgressRing';

interface Props {
  steps: number;
  goal: number;
  onEditGoal?: () => void;
}

const STROKE = 11;
/** Space kept between the number and the inside of the arc. */
const RING_INSET = 10;

const formatSteps = (value: number) => value.toLocaleString();

/**
 * The day's headline metric.
 *
 * The ring shows attainment and the right column says what is left — the same
 * fact framed as progress and as remaining work, which is the difference
 * between "how am I doing" and "what do I still have to do".
 *
 * Three sizes carry that reading order and nothing else does: the step count
 * is `h1`, the two figures derived from it (`62%`, `3,755`) share `h2`, and
 * every word explaining a figure is `caption`. The derived pair has to stay a
 * step above `caption` or it reads as an annotation rather than a number —
 * but only one step below the count, or three headlines compete in one card.
 *
 * The ring is sized from the screen rather than fixed: three columns beside a
 * fixed ring do not fit a 320pt phone, and the number inside it is fitted to
 * the arc's inner width, so a six-digit count cannot grow into the stroke.
 */
export const StepGoalCard = memo(({ steps, goal, onEditGoal }: Props) => {
  const { colors } = useTheme();
  const { width } = useResponsive();

  const ringSize = width < 360 ? 108 : width < 400 ? 118 : 132;
  const numberMaxWidth = ringSize - STROKE * 2 - RING_INSET * 2;

  const { progress, percent, remaining } = useMemo(() => {
    const safeGoal = Math.max(1, goal);
    return {
      progress: steps / safeGoal,
      percent: Math.round((steps / safeGoal) * 100),
      remaining: Math.max(0, safeGoal - steps),
    };
  }, [steps, goal]);

  const reached = remaining === 0;

  return (
    <Card elevation="low" radius="xl" padding={width < 360 ? 'base' : 'lg'}>
      <VStack gap="base">
        <HStack align="center" justify="between">
          <AppText variant="label" color="text">
            Daily steps goal
          </AppText>

          {onEditGoal ? (
            <Pressable
              onPress={onEditGoal}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel="Edit daily step goal"
            >
              <HStack align="center" gap="xs">
                <AppText
                  variant="caption"
                  style={[styles.editLabel, { color: colors.brandAccent }]}
                >
                  Edit Goal
                </AppText>
                {/* An icon centred against a text's line box lands below the
                    glyph's optical centre, because the box reserves descender
                    room that "Edit Goal" never uses. */}
                <Box style={styles.editIcon}>
                  <Icon as={Pencil} size="xs" tint={colors.brandAccent} />
                </Box>
              </HStack>
            </Pressable>
          ) : null}
        </HStack>

        <HStack align="stretch">
          {/* Two parts of one figure, so they share the space by ratio rather
              than one of them owning a fixed slice. Bottom-aligned, which is
              what rests the percentage on the ring's baseline. */}
          <HStack flex={2} align="end" gap="xs">
            <ProgressRing
              progress={progress}
              size={ringSize}
              strokeWidth={STROKE}
              tint={colors.brandAccent}
            >
              <Icon as={Footprints} size="md" tint={colors.text} />
              <AppText
                variant="h3"
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ maxWidth: numberMaxWidth }}
              >
                {formatSteps(steps)}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {`/ ${formatSteps(goal)}`}
              </AppText>
            </ProgressRing>

            <VStack pb="sm" style={styles.percentBlock}>
              <AppText
                variant="bodyStrong"
                numberOfLines={1}
                // adjustsFontSizeToFit
                style={{ color: colors.brandAccent }}
              >
                {`${percent}%`}
              </AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                Completed
              </AppText>
            </VStack>
          </HStack>

          <Divider orientation="vertical" inset="xs" />

          <VStack flex={1} justify="center" gap="xxs" pl="base">
            {/* A bare flag, not an IconBadge: the disc would put a second
                filled shape beside the ring and the card only has room for
                one focal circle. */}
            <Box pb="xs">
              <Icon as={Flag} size="lg" tint={colors.success} />
            </Box>

            {reached ? (
              <>
                <AppText variant="bodyStrong">Goal reached</AppText>
                <AppText variant="caption" color="textTertiary">
                  Nice work today
                </AppText>
              </>
            ) : (
              <>
                <AppText variant="h3" numberOfLines={1} adjustsFontSizeToFit>
                  {formatSteps(remaining)}
                </AppText>
                <AppText variant="bodyStrong">steps left</AppText>
                <AppText variant="caption" color="textTertiary">
                  to reach your daily goal
                </AppText>
              </>
            )}
          </VStack>
        </HStack>
      </VStack>
    </Card>
  );
});

StepGoalCard.displayName = 'StepGoalCard';

/**
 * What is left after the layout components: an underline and a one-pixel
 * optical nudge. Neither is a layout concern, so neither belongs in a Stack.
 */
const styles = StyleSheet.create({
  editLabel: { textDecorationLine: 'underline' },
  editIcon: { transform: [{ translateY: -1 }] },
  percentBlock: { flexShrink: 1 },
});
