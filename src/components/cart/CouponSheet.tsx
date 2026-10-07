import React, { memo, useCallback, useEffect, useState } from 'react';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '../disclosure/BottomSheet';
import { Input } from '../form/Input';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Tries the code. Resolves to null when it applied — the sheet closes —
   * or to why not, which the sheet shows under the field.
   */
  onApply: (code: string) => Promise<string | null>;
}

/** The longest code the server takes. */
const MAX_CODE = 24;

/**
 * Where a coupon code is typed. The field shouts back in capitals, as
 * codes are printed, and the server's refusal — "Add ₹150 more to use
 * FIT50" — sits under it until the code changes. The sheet rides up with
 * the keyboard, which would otherwise cover the field it was opened for.
 */
export const CouponSheet = memo(({ visible, onClose, onApply }: Props) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const { height } = useReanimatedKeyboardAnimation();
  const lift = useAnimatedStyle(() => ({
    height: Math.max(0, -height.value - insets.bottom),
  }));

  // Every opening starts clean.
  useEffect(() => {
    if (visible) {
      setCode('');
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const onChange = useCallback((text: string) => {
    setCode(text.toUpperCase());
    setError(null);
  }, []);

  const apply = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Enter a coupon code.');
      return;
    }
    setBusy(true);
    const problem = await onApply(trimmed);
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    onClose();
  }, [code, onApply, onClose]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Apply a coupon">
      <VStack gap="md" pb="base">
        <AppText variant="caption" color="textSecondary">
          Enter the code exactly as you got it. One coupon per order.
        </AppText>
        <Input
          label="Coupon code"
          value={code}
          onChangeText={onChange}
          placeholder="e.g. WELCOME10"
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          maxLength={MAX_CODE}
          returnKeyType="done"
          onSubmitEditing={apply}
          error={error ?? undefined}
          accessibilityLabel="Coupon code"
        />
        <Button
          label="Apply"
          variant="brand"
          fullWidth
          loading={busy}
          disabled={busy || code.trim().length === 0}
          onPress={apply}
        />
      </VStack>
      <Animated.View style={lift} />
    </BottomSheet>
  );
});

CouponSheet.displayName = 'CouponSheet';
