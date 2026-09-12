import React, { memo } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';

interface Props {
  icon: LucideIcon;
  title: string;
  message?: string;
  /** Icon colour. Defaults to the brand accent. */
  tint?: string;
}

/**
 * A standing piece of reassurance or guidance beside a form.
 *
 * Deliberately not an `Alert`: an Alert reports a *condition* — something has
 * gone wrong, or is about to — and it can be dismissed. This is always true,
 * always present, and never in the way. Sharing the Alert component for both
 * would mean a dismissible security warning, which is not a warning.
 */
export const InfoNote = memo(({ icon, title, message, tint }: Props) => {
  const { colors } = useTheme();

  return (
    <Box bg="card" radius="lg" p="base" bordered>
      <HStack gap="md" align="center">
        <Icon as={icon} size="lg" tint={tint ?? colors.brandAccent} />
        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong">{title}</AppText>
          {message ? (
            <AppText variant="caption" color="textSecondary">
              {message}
            </AppText>
          ) : null}
        </VStack>
      </HStack>
    </Box>
  );
});

InfoNote.displayName = 'InfoNote';
