import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { BadgeCheck, CircleAlert } from 'lucide-react-native';
import type { DailyActivity } from '../../types/models';
import { useTheme } from '../../theme';
import { formatGrouped } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';

interface Props {
  day: DailyActivity;
  /** The server's own words on how the figure was reached, in order. */
  explanation: string[];
}

/**
 * The day's answer, and how it was reached. The lines are the server's —
 * it is the one that matched the sources, so it is the one that explains.
 */
export const SourcesSummaryCard = memo(({ day, explanation }: Props) => {
  const { colors } = useTheme();
  const tint = day.verified ? colors.success : colors.warning;

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <HStack align="start" justify="between" gap="md">
          <VStack flex={1} gap="xxs">
            <AppText variant="label" color="textSecondary">
              Counted for the day
            </AppText>
            <AppText variant="h1">{`${formatGrouped(
              day.steps,
            )} steps`}</AppText>
            <AppText variant="caption" color="textSecondary">
              {`${formatGrouped(day.verifiedSteps)} verified`}
            </AppText>
          </VStack>
          <Chip
            label={day.verified ? 'Verified' : 'Not verified'}
            tint={tint}
          />
        </HStack>

        <Divider />

        <VStack gap="sm">
          {explanation.map((line, index) => {
            const last = index === explanation.length - 1;
            return (
              <HStack key={index} align="start" gap="sm">
                {last ? (
                  <Icon
                    as={day.verified ? BadgeCheck : CircleAlert}
                    size="xs"
                    tint={tint}
                  />
                ) : (
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: colors.textTertiary },
                    ]}
                  />
                )}
                <AppText
                  variant="caption"
                  color="textSecondary"
                  style={styles.line}
                >
                  {line}
                </AppText>
              </HStack>
            );
          })}
        </VStack>
      </VStack>
    </Card>
  );
});

SourcesSummaryCard.displayName = 'SourcesSummaryCard';

const styles = StyleSheet.create({
  line: { flex: 1 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    marginHorizontal: 3,
  },
});
