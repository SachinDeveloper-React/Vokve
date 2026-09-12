import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';
import { BottomSheet } from './BottomSheet';

export interface SheetAction {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  /** Renders in the destructive colour and reads as such to screen readers. */
  destructive?: boolean;
  disabled?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  actions: SheetAction[];
  cancelLabel?: string;
}

const ActionRow = memo(
  ({ action, onSelect }: { action: SheetAction; onSelect: () => void }) => {
    const { colors } = useTheme();
    const color = action.destructive ? colors.destructive : colors.text;

    return (
      <Pressable
        onPress={onSelect}
        disabled={action.disabled}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        accessibilityState={{ disabled: Boolean(action.disabled) }}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? colors.muted : 'transparent' },
          action.disabled && styles.disabled,
        ]}
      >
        {action.icon ? (
          <Icon as={action.icon} size="md" tint={color} />
        ) : null}
        <AppText variant="body" style={{ color }}>
          {action.label}
        </AppText>
      </Pressable>
    );
  },
);

ActionRow.displayName = 'ActionRow';

/**
 * A list of choices in a bottom sheet. Each action closes the sheet before it
 * runs: firing the handler first can navigate away while the sheet is still
 * mounted, which leaves it stranded over the next screen.
 */
export const ActionSheet = memo(
  ({
    visible,
    onClose,
    title,
    message,
    actions,
    cancelLabel = 'Cancel',
  }: Props) => {
    const { colors } = useTheme();

    const select = useCallback(
      (action: SheetAction) => {
        onClose();
        action.onPress();
      },
      [onClose],
    );

    return (
      <BottomSheet visible={visible} onClose={onClose} title={title}>
        {message ? (
          <AppText variant="caption" color="textSecondary" style={styles.message}>
            {message}
          </AppText>
        ) : null}

        <View style={styles.list}>
          {actions.map(action => (
            <ActionRow
              key={action.label}
              action={action}
              onSelect={() => select(action)}
            />
          ))}
        </View>

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          style={({ pressed }) => [
            styles.cancel,
            {
              backgroundColor: pressed ? colors.accent : colors.secondary,
            },
          ]}
        >
          <AppText variant="bodyStrong">{cancelLabel}</AppText>
        </Pressable>
      </BottomSheet>
    );
  },
);

ActionSheet.displayName = 'ActionSheet';

const styles = StyleSheet.create({
  message: { marginBottom: spacing.md },
  list: { marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    minHeight: 52,
  },
  disabled: { opacity: 0.4 },
  cancel: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.base,
    borderRadius: radius.md,
    minHeight: 52,
  },
});
