import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

interface Props {
  tone?: AlertTone;
  title: string;
  message?: string;
  onDismiss?: () => void;
  action?: React.ReactNode;
}

const ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
} as const;

/**
 * An inline banner — a persistent condition on the screen it belongs to, such
 * as a failed sync or an offline notice. For something transient that does not
 * belong to any one screen, use a Toast.
 *
 * Note this shadows React Native's own imperative `Alert` API. Import the
 * platform dialog as `import { Alert as NativeAlert } from 'react-native'`
 * where both are needed in one file.
 */
export const Alert = memo(
  ({ tone = 'info', title, message, onDismiss, action }: Props) => {
    const { colors } = useTheme();

    const toneColor = useMemo(() => {
      switch (tone) {
        case 'success':
          return colors.success;
        case 'warning':
          return colors.warning;
        case 'error':
          return colors.destructive;
        default:
          return colors.primary;
      }
    }, [tone, colors]);

    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            // A left rule carries the tone without tinting the whole surface,
            // which keeps the text contrast identical in both themes.
            borderLeftColor: toneColor,
          },
        ]}
        accessibilityRole="alert"
        accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      >
        <View style={styles.iconSlot}>
          <Icon as={ICONS[tone]} size="md" tint={toneColor} />
        </View>

        <View style={styles.body}>
          <AppText variant="bodyStrong">{title}</AppText>
          {message ? (
            <AppText variant="caption" color="textSecondary">
              {message}
            </AppText>
          ) : null}
          {action ? <View style={styles.action}>{action}</View> : null}
        </View>

        {onDismiss ? (
          <Pressable
            onPress={onDismiss}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Icon as={X} size="sm" color="textTertiary" />
          </Pressable>
        ) : null}
      </View>
    );
  },
);

Alert.displayName = 'Alert';

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
  },
  iconSlot: { paddingTop: 1 },
  body: { flex: 1, gap: spacing.xxs },
  action: { marginTop: spacing.sm, alignSelf: 'flex-start' },
});
