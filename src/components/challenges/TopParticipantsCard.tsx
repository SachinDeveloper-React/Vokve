import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { ChallengeMetric, ChallengeParticipant } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Pressable } from '../form/Pressable';
import { METRIC_STYLE, formatMetricValue, formatProgress } from './metrics';

const DISC = moderateScale(20);

interface Props {
  participants: ChallengeParticipant[];
  metric: ChallengeMetric;
  goal: number;
  onPressViewAll: () => void;
}

/**
 * The top of the board at a glance — three names, three figures.
 *
 * Three across rather than three rows: this sits under the rules as a reason
 * to keep walking, not as the board itself. The board is a tab away, which is
 * where "View All" goes rather than to a screen of its own.
 */
export const TopParticipantsCard = memo(
  ({ participants, metric, goal, onPressViewAll }: Props) => {
    const { colors, isDark } = useTheme();
    const tint = colors[METRIC_STYLE[metric].tint];
    const top = participants.slice(0, 3);

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack align="center" justify="between" gap="sm">
            <AppText variant="h3">Top Participants</AppText>

            {participants.length > top.length ? (
              <Pressable
                onPress={onPressViewAll}
                feedback="opacity"
                accessibilityRole="link"
                accessibilityLabel="View all participants"
              >
                <HStack align="center" gap="xxs">
                  <AppText
                    variant="micro"
                    style={{ color: colors.brandAccent }}
                  >
                    View All
                  </AppText>
                  <Icon
                    as={ChevronRight}
                    size="xs"
                    tint={colors.brandAccent}
                  />
                </HStack>
              </Pressable>
            ) : null}
          </HStack>

          {top.length === 0 ? (
            <EmptyState
              title="Nobody has started yet"
              message="Be the first name on this board."
            />
          ) : (
            <HStack align="start" gap="sm">
              {top.map(participant => (
                <VStack
                  key={participant.id}
                  flex={1}
                  gap="xs"
                  accessible
                  accessibilityLabel={`Rank ${participant.rank}, ${
                    participant.name
                  }, ${formatProgress(participant.progress, goal, metric)}`}
                >
                  <HStack align="center" gap="xs">
                    <View
                      style={[
                        styles.disc,
                        {
                          borderColor: tint,
                          backgroundColor: withAlpha(tint, isDark ? 0.22 : 0.1),
                        },
                      ]}
                    >
                      <AppText variant="miniMicro" style={{ color: tint }}>
                        {participant.rank}
                      </AppText>
                    </View>
                    <AppText
                      variant="micro"
                      numberOfLines={1}
                      style={styles.name}
                    >
                      {participant.isCurrentUser
                        ? `${participant.name} (you)`
                        : participant.name}
                    </AppText>
                  </HStack>

                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {formatMetricValue(participant.progress, metric)}
                  </AppText>
                </VStack>
              ))}

              {/* Keeps three columns the same width when fewer have started. */}
              {Array.from({ length: 3 - top.length }, (_, index) => (
                <View key={`gap-${index}`} style={styles.filler} />
              ))}
            </HStack>
          )}
        </VStack>
      </Card>
    );
  },
);

TopParticipantsCard.displayName = 'TopParticipantsCard';

const styles = StyleSheet.create({
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { flex: 1 },
  filler: { flex: 1 },
});
