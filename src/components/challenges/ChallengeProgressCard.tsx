import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Clock } from 'lucide-react-native';
import { ProgressRing } from '../fitness/ProgressRing';
import { moderateScale } from '../../theme/responsive';
import { radius, useTheme } from '../../theme';
import type { ChallengeDetail } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { formatCompactNumber, formatGrouped } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { METRIC_STYLE } from './metrics';

const RING = moderateScale(116);

/** "08h 24m", or "24m 05s" in the last hour — a clock that never shows "0h 0m". */
export function formatTimeLeft(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const pad = (value: number) => String(value).padStart(2, '0');
  if (seconds >= 3600) {
    return `${pad(Math.floor(seconds / 3600))}h ${pad(Math.floor((seconds % 3600) / 60))}m`;
  }
  return `${pad(Math.floor(seconds / 60))}m ${pad(seconds % 60)}s`;
}

interface Props {
  detail: ChallengeDetail;
  /**
   * Seconds until the focus window closes, ticking. Null once it has passed,
   * or for a challenge with no clock to show.
   */
  secondsLeft: number | null;
}

/**
 * How far the member has got, and how long they have to finish.
 *
 * The ring counts the window the server chose (`focus`) rather than the whole
 * challenge: a 70,000-step week is not something anyone can act on today, and
 * a ring that crawled a seventh of the way round each day would tell a walker
 * nothing about whether today has been enough. The period is still on screen —
 * as "Day 3 of 7" above, and as the goal the reward card pays out on.
 *
 * Every figure is written out as well as drawn. The percentage beside the bar,
 * the figure under the ring and the "steps left" column all say the same
 * thing, because a reader who cannot judge an arc by eye is exactly the reader
 * who needs to know they are 2,158 short.
 */
export const ChallengeProgressCard = memo(({ detail, secondsLeft }: Props) => {
  const { colors, isDark } = useTheme();
  const { focus, period, challenge } = detail;
  const tint = colors[METRIC_STYLE[challenge.metric].tint];
  const unit = METRIC_STYLE[challenge.metric].unit;
  const share = focus.target > 0 ? focus.value / focus.target : 0;
  const percent = Math.min(100, Math.round(share * 100));

  // Compact above five digits: a monthly goal runs to six, and the ring has
  // room for a figure, not a sentence.
  const write = (value: number) =>
    value >= 100_000 ? formatCompactNumber(value) : formatGrouped(value);

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <HStack align="center" justify="between" gap="sm">
          <AppText variant="h3">Your Progress</AppText>
          <AppText variant="micro" color="textSecondary">
            {`Day ${period.day} of ${period.days}`}
          </AppText>
        </HStack>

        <HStack align="center" gap="base">
          <ProgressRing
            progress={share}
            size={RING}
            strokeWidth={moderateScale(10)}
            tint={tint}
            value={write(focus.value)}
            label={unit}
          />

          <VStack flex={1} gap="md">
            <HStack align="end" justify="between" gap="sm">
              <VStack gap="xxs" flex={1}>
                <AppText variant="caption" color="textSecondary">
                  {focus.label}
                </AppText>
                <AppText variant="h2" numberOfLines={1}>
                  {`${write(focus.target)} ${unit}`}
                </AppText>
              </VStack>

              <VStack align="end" gap="xxs">
                <AppText variant="h2" numberOfLines={1} style={{ color: tint }}>
                  {write(focus.remaining)}
                </AppText>
                <AppText variant="miniMicro" color="textSecondary">
                  {`${unit} left`}
                </AppText>
              </VStack>
            </HStack>

            <HStack align="center" gap="sm">
              <VStack flex={1}>
                <ProgressBar progress={share} tint={tint} />
              </VStack>
              <AppText variant="micro" color="textSecondary">
                {`${percent}%`}
              </AppText>
            </HStack>
          </VStack>
        </HStack>

        {secondsLeft === null ? null : (
          <HStack
            align="center"
            justify="center"
            gap="sm"
            py="md"
            px="base"
            style={[
              styles.clock,
              {
                backgroundColor: withAlpha(
                  colors.brandAccent,
                  isDark ? 0.18 : 0.1,
                ),
              },
            ]}
            accessible
            accessibilityLabel={`${focus.caption} ${formatTimeLeft(secondsLeft)}`}
          >
            <Icon as={Clock} size="xs" tint={colors.brandAccent} />
            <AppText variant="micro" style={{ color: colors.brandAccent }}>
              {focus.caption}
            </AppText>
            <AppText variant="bodyStrong" style={{ color: colors.brandAccent }}>
              {formatTimeLeft(secondsLeft)}
            </AppText>
          </HStack>
        )}
      </VStack>
    </Card>
  );
});

ChallengeProgressCard.displayName = 'ChallengeProgressCard';

const styles = StyleSheet.create({
  clock: { borderRadius: radius.md },
});
