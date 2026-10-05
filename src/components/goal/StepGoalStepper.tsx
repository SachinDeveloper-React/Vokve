import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Minus, Plus, type LucideIcon } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { formatGrouped } from '../../utils/format';
import { Pressable } from '../form/Pressable';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { snapGoal, type GoalRange } from './goalScale';

const BUTTON = moderateScale(52);

interface Props {
  value: number;
  range: GoalRange;
  onChange: (value: number) => void;
}

const RoundButton = ({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) => {
  const { colors, isDark } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.round,
        { backgroundColor: withAlpha(colors.brandAccent, isDark ? 0.2 : 0.12) },
      ]}
    >
      <Icon as={icon} size="md" tint={colors.brandAccent} strokeWidth={2.5} />
    </Pressable>
  );
};

/**
 * The goal being set, with a step down and a step up either side — one
 * increment a tap, stopping at the range's ends.
 */
export const StepGoalStepper = memo(({ value, range, onChange }: Props) => {
  const { colors } = useTheme();
  const step = formatGrouped(range.increment);

  const down = useCallback(
    () => onChange(snapGoal(value - range.increment, range)),
    [onChange, range, value],
  );
  const up = useCallback(
    () => onChange(snapGoal(value + range.increment, range)),
    [onChange, range, value],
  );

  return (
    <HStack align="center" justify="between" gap="base">
      <RoundButton
        icon={Minus}
        label={`Lower the goal by ${step} steps`}
        disabled={value <= range.min}
        onPress={down}
      />

      <View
        style={[
          styles.value,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
        accessible
        accessibilityLabel={`${formatGrouped(value)} steps a day`}
        accessibilityLiveRegion="polite"
      >
        <AppText variant="metric" numberOfLines={1} adjustsFontSizeToFit>
          {formatGrouped(value)}
        </AppText>
        <AppText variant="caption" color="textTertiary">
          steps
        </AppText>
      </View>

      <RoundButton
        icon={Plus}
        label={`Raise the goal by ${step} steps`}
        disabled={value >= range.max}
        onPress={up}
      />
    </HStack>
  );
});

StepGoalStepper.displayName = 'StepGoalStepper';

const styles = StyleSheet.create({
  round: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    flex: 1,
    maxWidth: moderateScale(200),
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
