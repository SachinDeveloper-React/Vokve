import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, StyleSheet, TextInput } from 'react-native';
import { radius, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { Box } from '../layout/Box';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { FormControl, type FormControlProps } from './FormControl';

const BOX_HEIGHT = moderateScale(58);

/** Shown in an empty slot, so the field reads as six answers, not one blank. */
const EMPTY_MARK = '–';

/**
 * What a caller can do to the field from outside.
 *
 * Only focus, because that is the one thing the parent cannot express through
 * props: the value it already owns, but *where the keyboard is* is state that
 * lives inside the input. A screen that rejects a code has to clear it and put
 * the cursor back, and without this the user is left staring at six wrong
 * digits with no keyboard and no way to reach them.
 */
export interface OtpInputHandle {
  focus: () => void;
  blur: () => void;
}

interface Props extends Omit<FormControlProps, 'children'> {
  value: string;
  onChange: (value: string) => void;
  /** How many digits the code has. */
  length?: number;
  /** Fired the moment the last digit lands — usually to submit. */
  onComplete?: (code: string) => void;
  autoFocus?: boolean;
  /**
   * Names the field for assistive tech where the design carries no visible
   * label. Six unlabelled boxes are meaningless to a screen reader, and a
   * visible label is not always the right way to fix that.
   */
  accessibilityLabel?: string;
}

/**
 * A one-time-code field, drawn as one box per digit.
 *
 * Behind the boxes is a *single* transparent `TextInput`, not one per digit.
 * Six inputs are the obvious build and the wrong one: the OS fills a code from
 * an SMS into one field, so a split field silently loses autofill; paste drops
 * five of the six digits; and backspace at the start of an empty box has to be
 * hand-wired to step backwards, which is where these controls usually break.
 * One input gets all of that from the platform, and the boxes become pure
 * presentation.
 */
export const OtpInput = forwardRef<OtpInputHandle, Props>(
  (
    {
      value,
      onChange,
      length = 6,
      onComplete,
      autoFocus = false,
      accessibilityLabel,
      ...control
    },
    ref,
  ) => {
    const { colors } = useTheme();
    const input = useRef<React.ComponentRef<typeof TextInput>>(null);
    const [isFocused, setFocused] = useState(false);

    const digits = useMemo(
      () => Array.from({ length }, (_, index) => value[index] ?? ''),
      [length, value],
    );

    const handleChange = useCallback(
      (next: string) => {
        const cleaned = next.replace(/\D/g, '').slice(0, length);
        onChange(cleaned);

        if (cleaned.length === length) {
          onComplete?.(cleaned);
        }
      },
      [length, onChange, onComplete],
    );

    const focus = useCallback(() => input.current?.focus(), []);
    const handleFocus = useCallback(() => setFocused(true), []);
    const handleBlur = useCallback(() => setFocused(false), []);

    useImperativeHandle(ref, () => ({ focus, blur: () => input.current?.blur() }), [
      focus,
    ]);

    useEffect(() => {
      if (autoFocus) {
        // A frame late on purpose: focusing during the screen's entry
        // animation fights the transition and the keyboard opens half way.
        const timer = setTimeout(focus, 350);
        return () => clearTimeout(timer);
      }
    }, [autoFocus, focus]);

    /** The slot the next digit will land in — the caret, drawn as a border. */
    const activeIndex = Math.min(value.length, length - 1);

    return (
      <FormControl {...control}>
        <Box style={styles.field}>
          <HStack gap="sm" justify="between">
            {digits.map((digit, index) => {
              const isActive =
                isFocused && index === activeIndex && !control.disabled;

              return (
                <Box
                  // Slots are positional and interchangeable; there is no id to
                  // key by, and reordering is not a thing that can happen here.
                  key={index}
                  flex={1}
                  radius="lg"
                  style={[
                    styles.slot,
                    // A focused or invalid slot needs a full-pixel border for
                    // its colour to read at all, the same rule `Input` follows.
                    isActive || control.error
                      ? styles.slotEmphasised
                      : styles.slotRest,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: control.error
                        ? colors.destructive
                        : isActive
                        ? colors.brandAccent
                        : colors.input,
                    },
                  ]}
                >
                  <AppText
                    variant="h2"
                    color={digit ? 'text' : 'textTertiary'}
                    center
                  >
                    {digit || EMPTY_MARK}
                  </AppText>
                </Box>
              );
            })}
          </HStack>

          {/*
            Laid over the whole row rather than sized to a box: the tap target
            is every slot, so tapping any of them opens the keyboard. It is
            transparent instead of hidden because a `display: none` input
            cannot be focused on Android.
          */}
          <TextInput
            ref={input}
            style={styles.capture}
            value={value}
            onChangeText={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onPressIn={focus}
            editable={!control.disabled}
            keyboardType="number-pad"
            maxLength={length}
            caretHidden
            // The two names the platforms use for the same SMS autofill.
            textContentType="oneTimeCode"
            autoComplete={Platform.OS === 'ios' ? 'one-time-code' : 'sms-otp'}
            accessibilityLabel={
              accessibilityLabel ?? control.label ?? 'One-time code'
            }
            accessibilityHint={`Enter the ${length} digit code`}
            accessibilityState={{ disabled: Boolean(control.disabled) }}
          />
        </Box>
      </FormControl>
    );
  },
);

OtpInput.displayName = 'OtpInput';

const styles = StyleSheet.create({
  field: { position: 'relative' },
  slot: {
    height: BOX_HEIGHT,
    justifyContent: 'center',
    borderRadius: radius.lg,
  },
  slotRest: { borderWidth: StyleSheet.hairlineWidth },
  slotEmphasised: { borderWidth: 1.5 },
  // The one thing the layout primitives cannot express: an input that covers
  // its siblings instead of taking a place in the row.
  capture: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    // Android ignores taps on a zero-opacity input without an explicit colour.
    color: 'transparent',
  },
});
