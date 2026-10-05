import React, { memo } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import {
  ChartColumnIncreasing,
  Target,
  type LucideIcon,
} from 'lucide-react-native';
import { typography, useTheme } from '../../theme';
import { formatGrouped } from '../../utils/format';
import { Pressable } from '../form/Pressable';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

interface Props {
  /** The goal as it stands. */
  current: number;
  /** The server's suggestion; null until it has answered, or when it could not. */
  recommended: number | null;
  /** The suggestion is on its way. */
  loading?: boolean;
  /** Takes the suggestion as the goal being set. */
  onUseRecommended: () => void;
}

const Figure = ({
  icon,
  label,
  steps,
  loading = false,
}: {
  icon: LucideIcon;
  label: string;
  steps: number | null;
  loading?: boolean;
}) => {
  const { colors } = useTheme();
  return (
    <HStack flex={1} align="center" gap="md">
      <Icon as={icon} size="lg" tint={colors.brandAccent} />
      <VStack flex={1} gap="xxs">
        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
          {label}
        </AppText>
        {steps === null && loading ? (
          <ActivityIndicator
            color={colors.brandAccent}
            style={styles.loading}
          />
        ) : (
          <AppText variant="h1" numberOfLines={1} adjustsFontSizeToFit>
            {steps === null ? '—' : formatGrouped(steps)}
          </AppText>
        )}
        <AppText variant="caption" color="textTertiary">
          steps
        </AppText>
      </VStack>
    </HStack>
  );
};

/**
 * The goal now beside the one suggested — the two figures the slider below
 * is set between. The suggestion is a button too: one tap takes it.
 */
export const StepGoalSummaryCard = memo(
  ({ current, recommended, loading = false, onUseRecommended }: Props) => (
    <Card elevation="flat" radius="lg" padding="base">
      <HStack align="stretch" gap="sm">
        <Figure icon={Target} label="Current Daily Goal" steps={current} />

        <Divider orientation="vertical" inset="xs" />

        <Pressable
          onPress={onUseRecommended}
          disabled={recommended === null}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel={
            recommended === null
              ? 'Recommended goal, not available yet'
              : `Use the recommended goal, ${formatGrouped(recommended)} steps`
          }
          style={styles.recommended}
        >
          <Figure
            icon={ChartColumnIncreasing}
            label="Recommended Goal"
            steps={recommended}
            loading={loading}
          />
        </Pressable>
      </HStack>
    </Card>
  ),
);

StepGoalSummaryCard.displayName = 'StepGoalSummaryCard';

const styles = StyleSheet.create({
  recommended: { flex: 1 },
  // The spinner holds the figure's line, so nothing moves when it lands.
  loading: { alignSelf: 'flex-start', minHeight: typography.h1.lineHeight },
});
