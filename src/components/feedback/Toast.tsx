import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react-native';
import { duration as durations, radius, spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';
import type { AlertTone } from './Alert';

export interface ToastOptions {
  title: string;
  message?: string;
  tone?: AlertTone;
  /** Milliseconds on screen. Pass 0 to require a tap to dismiss. */
  durationMs?: number;
}

interface ToastRecord extends Required<Omit<ToastOptions, 'message'>> {
  id: string;
  message?: string;
}

interface ToastContextValue {
  show: (options: ToastOptions) => string;
  hide: (id: string) => void;
  hideAll: () => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const DEFAULT_DURATION = 3200;
/** Older toasts are dropped past this so a burst cannot cover the screen. */
const MAX_VISIBLE = 3;

const ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
} as const;

const ToastItem = memo(
  ({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) => {
    const { colors } = useTheme();
    const progress = useSharedValue(0);

    useEffect(() => {
      progress.value = withTiming(1, { duration: durations.fast });
    }, [progress]);

    const animatedStyle = useAnimatedStyle(() => ({
      opacity: progress.value,
      transform: [{ translateY: (1 - progress.value) * -12 }],
    }));

    const toneColor =
      toast.tone === 'success'
        ? colors.success
        : toast.tone === 'warning'
        ? colors.warning
        : toast.tone === 'error'
        ? colors.destructive
        : colors.primary;

    return (
      <Animated.View style={animatedStyle}>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={`${toast.title}. Tap to dismiss.`}
          style={[
            styles.toast,
            { backgroundColor: colors.popover, borderColor: colors.border },
          ]}
        >
          <Icon as={ICONS[toast.tone]} size="md" tint={toneColor} />
          <View style={styles.toastBody}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {toast.title}
            </AppText>
            {toast.message ? (
              <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                {toast.message}
              </AppText>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    );
  },
);

ToastItem.displayName = 'ToastItem';

/**
 * Toasts are transient and belong to no particular screen, so they live in a
 * provider above the navigator and survive navigation. Anything that describes
 * a persistent condition on one screen should be an inline Alert instead.
 */
export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const insets = useSafeAreaInsets();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const hide = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts(current => current.filter(t => t.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const record: ToastRecord = {
        id,
        title: options.title,
        message: options.message,
        tone: options.tone ?? 'info',
        durationMs: options.durationMs ?? DEFAULT_DURATION,
      };

      setToasts(current => [...current, record].slice(-MAX_VISIBLE));

      if (record.durationMs > 0) {
        timers.current.set(
          id,
          setTimeout(() => hide(id), record.durationMs),
        );
      }
      return id;
    },
    [hide],
  );

  const hideAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    setToasts([]);
  }, []);

  // Pending timers would otherwise fire into an unmounted tree.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ show, hide, hideAll }),
    [show, hide, hideAll],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View
        style={[styles.overlay, { top: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        {toasts.map(toast => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={() => hide(toast.id)}
          />
        ))}
      </View>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: spacing.base,
    right: spacing.base,
    gap: spacing.sm,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    // Lifted off the content underneath so it reads as an overlay.
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  toastBody: { flex: 1, gap: spacing.xxs },
});
