import React, { memo } from 'react';
import { ChevronRight, RotateCw } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { formatCountdown } from '../../utils/format';
import { Box } from '../layout/Box';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';
import { Pressable } from '../form/Pressable';

interface Props {
  onResend: () => void;
  /** Seconds until resending is allowed. Zero means it is available now. */
  secondsUntilAvailable: number;
  /** Set while the resend request is in flight. */
  isSending?: boolean;
}

/**
 * The "send it again" row under a one-time code.
 *
 * The wait is shown as a running clock rather than a disabled button with no
 * explanation. A code that has not arrived is the single most anxious moment
 * in a sign-up, and "nothing happens when I tap it" is the reading people
 * reach for; a number ticking down says the app is working and how long is
 * left. The row stays visible, and only its action is gated.
 */
export const ResendOtpRow = memo(
  ({ onResend, secondsUntilAvailable, isSending = false }: Props) => {
    const { colors } = useTheme();

    const isWaiting = secondsUntilAvailable > 0;
    const isDisabled = isWaiting || isSending;

    return (
      <Pressable
        onPress={onResend}
        disabled={isDisabled}
        feedback="highlight"
        accessibilityRole="button"
        accessibilityLabel="Resend OTP"
        accessibilityHint={
          isWaiting
            ? `Available in ${secondsUntilAvailable} seconds`
            : 'Sends a new code to your number'
        }
        accessibilityState={{ disabled: isDisabled, busy: isSending }}
      >
        <Box bg="card" radius="lg" p="base" bordered>
          <HStack gap="md" align="center">
            <Icon
              as={RotateCw}
              size="md"
              color={isWaiting ? 'textTertiary' : 'text'}
            />

            <AppText variant="bodyStrong" style={FLEX_1}>
              {isSending ? 'Sending…' : 'Resend OTP'}
            </AppText>

            {isWaiting ? (
              <AppText
                variant="bodyStrong"
                style={{ color: colors.brandAccent }}
              >
                {formatCountdown(secondsUntilAvailable)}
              </AppText>
            ) : null}

            <Icon
              as={ChevronRight}
              size="md"
              color={isWaiting ? 'textTertiary' : 'textSecondary'}
            />
          </HStack>
        </Box>
      </Pressable>
    );
  },
);

ResendOtpRow.displayName = 'ResendOtpRow';

/** Frozen at module scope so the label does not get a new style each render. */
const FLEX_1 = { flex: 1 } as const;
