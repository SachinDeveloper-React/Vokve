import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { moderateScale } from '../../theme/responsive';
import { radius, spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';
import { Pressable } from './Pressable';

const BOX_SIZE = moderateScale(22);

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  /**
   * A rich label — inline links, mixed colours — shown in place of `label`.
   *
   * `label` is still required alongside it and still names the control for
   * assistive tech: a screen reader cannot read a React element, and the whole
   * row is one touch target, so the accessible name has to be a plain string.
   */
  labelSlot?: React.ReactNode;
  helper?: string;
  disabled?: boolean;
  error?: boolean;
  /**
   * Which accent fills the box once it is ticked. `brand` is the wordmark's
   * orange, reserved for the one consent a screen is built around — accepting
   * the terms on sign-up — so it never competes with `primary` elsewhere.
   */
  tone?: 'primary' | 'brand';
}

/**
 * A checkbox with its label as part of the touch target — tapping the words
 * toggles it, which is what people expect and what makes the control usable
 * without precise aim.
 */
export const Checkbox = memo(
  ({
    checked,
    onChange,
    label,
    labelSlot,
    helper,
    disabled = false,
    error = false,
    tone = 'primary',
  }: Props) => {
    const { colors } = useTheme();
    const toggle = useCallback(() => onChange(!checked), [checked, onChange]);

    const accent = tone === 'brand' ? colors.brandAccent : colors.primary;

    const borderColor = error
      ? colors.destructive
      : checked
      ? accent
      : colors.switchBackground;

    return (
      <Pressable
        onPress={toggle}
        disabled={disabled}
        feedback="opacity"
        visualSize={BOX_SIZE}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel={label}
        accessibilityHint={helper}
        style={styles.row}
      >
        <View
          style={[
            styles.box,
            styles.boxEmpty,
            { borderColor },
            checked && { backgroundColor: accent },
          ]}
        >
          {checked ? (
            <Icon as={Check} size="sm" tint={colors.primaryForeground} />
          ) : null}
        </View>

        {labelSlot || label ? (
          <View style={styles.text}>
            {labelSlot ?? <AppText variant="body">{label}</AppText>}
            {helper ? (
              <AppText variant="caption" color={error ? 'destructive' : 'textSecondary'}>
                {helper}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    );
  },
);

Checkbox.displayName = 'Checkbox';

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  box: {
    width: BOX_SIZE,
    height: BOX_SIZE,
    borderRadius: radius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Optically aligns the box with the first line of the label.
    marginTop: 1,
  },
  boxEmpty: { backgroundColor: 'transparent' },
  text: { flex: 1, gap: spacing.xxs },
});
