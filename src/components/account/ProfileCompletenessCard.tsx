import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronRight, CircleCheckBig } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { ProfileGap } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { Pressable } from '../form/Pressable';

interface Props {
  /** 0–100, as the server counted it (RULES P6). */
  percent: number;
  /** What is still missing, most valuable first. */
  gaps: readonly ProfileGap[];
  /** Opens the edit form, focused on the field that was tapped. */
  onPressGap: (field: ProfileGap['field']) => void;
}

/** How many gaps are worth showing before the list becomes a chore. */
const VISIBLE_GAPS = 3;

/**
 * How complete the profile is, and the next thing that would improve it.
 *
 * The card disappears at 100% rather than congratulating the user forever:
 * a finished checklist is clutter, and the account screen has plenty to say
 * without it. Below that it names the gaps rather than only the number —
 * "82% complete" tells a user nothing they can act on.
 */
export const ProfileCompletenessCard = memo(
  ({ percent, gaps, onPressGap }: Props) => {
    const { colors } = useTheme();
    const press = useCallback(
      (field: ProfileGap['field']) => () => onPressGap(field),
      [onPressGap],
    );

    if (percent >= 100 || gaps.length === 0) {
      return null;
    }

    return (
      <Card radius="xl" padding="base">
        <VStack gap="md">
          <HStack align="center" justify="between" gap="sm">
            <VStack gap="xxs" flex={1}>
              <AppText variant="bodyStrong">Finish your profile</AppText>
              <AppText variant="micro" color="textSecondary">
                A fuller profile means better goals and faster checkout.
              </AppText>
            </VStack>
            <AppText variant="h3" style={{ color: colors.primary }}>
              {`${percent}%`}
            </AppText>
          </HStack>

          <ProgressBar progress={percent / 100} tint={colors.primary} />

          <VStack gap="xs">
            {gaps.slice(0, VISIBLE_GAPS).map(gap => (
              <Pressable
                key={gap.field}
                onPress={press(gap.field)}
                feedback="opacity"
                accessibilityRole="button"
                accessibilityLabel={gap.label}
                style={styles.row}
              >
                <HStack align="center" gap="sm">
                  <Icon
                    as={CircleCheckBig}
                    size="sm"
                    tint={colors.textQuaternary}
                  />
                  <AppText variant="body" style={styles.grow}>
                    {gap.label}
                  </AppText>
                  <AppText variant="micro" color="textTertiary">
                    {`+${gap.weight}%`}
                  </AppText>
                  <Icon as={ChevronRight} size="sm" color="textTertiary" />
                </HStack>
              </Pressable>
            ))}
          </VStack>
        </VStack>
      </Card>
    );
  },
);

ProfileCompletenessCard.displayName = 'ProfileCompletenessCard';

const styles = StyleSheet.create({
  row: { paddingVertical: 6 },
  grow: { flex: 1 },
});
