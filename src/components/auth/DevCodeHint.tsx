import React, { memo, useCallback } from 'react';
import { Bug } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { Box } from '../layout/Box';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  /** The code the server echoed — only ever set in development (`OTP_DEV_ECHO`). */
  code: string | null;
  /** Fills the OTP field with it. */
  onUse: (code: string) => void;
}

/**
 * The OTP, on the OTP screen, in development builds only.
 *
 * Until an SMS provider exists, and on a simulator with no mailbox, the code
 * the server generated has nowhere to go but its own log. This puts it on
 * the screen that is asking for it, so the flow can be walked on a device
 * without a terminal open. Two guards, either of which is enough: the
 * server only echoes the code when `OTP_DEV_ECHO` is on, which it refuses in
 * production, and this component renders nothing outside `__DEV__` even if
 * the code were somehow present.
 */
export const DevCodeHint = memo(({ code, onUse }: Props) => {
  const { colors } = useTheme();
  const use = useCallback(() => {
    if (code) {
      onUse(code);
    }
  }, [code, onUse]);

  if (!__DEV__ || !code) {
    return null;
  }

  return (
    <Pressable
      onPress={use}
      feedback="opacity"
      accessibilityRole="button"
      accessibilityLabel={`Development code ${code}, tap to fill`}
    >
      <Box bg="card" radius="lg" px="base" py="sm" bordered>
        <HStack align="center" gap="sm">
          <Icon as={Bug} size="sm" tint={colors.warning} />
          <AppText variant="caption" color="textSecondary">
            Dev build · code is{' '}
          </AppText>
          <AppText variant="bodyStrong" style={{ color: colors.warning }}>
            {code}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            · tap to fill
          </AppText>
        </HStack>
      </Box>
    </Pressable>
  );
});

DevCodeHint.displayName = 'DevCodeHint';
