import React, { memo } from 'react';
import { Switch } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

interface Props {
  icon: LucideIcon;
  title: string;
  caption: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

/**
 * One delivery preference: a glyph, what it is and a line on what it
 * means, and a switch in the brand orange — the colour this page's choices
 * are made in.
 */
export const DeliveryToggleRow = memo(
  ({ icon, title, caption, value, onChange }: Props) => {
    const { colors } = useTheme();
    return (
      <HStack align="center" gap="md">
        <Icon as={icon} size="sm" color="textSecondary" />
        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong">{title}</AppText>
          <AppText variant="micro" color="textSecondary">
            {caption}
          </AppText>
        </VStack>
        <Switch
          value={value}
          onValueChange={onChange}
          accessibilityLabel={title}
          accessibilityHint={caption}
          trackColor={{
            false: colors.switchBackground,
            true: colors.brandAccent,
          }}
          thumbColor={colors.primaryForeground}
          ios_backgroundColor={colors.switchBackground}
        />
      </HStack>
    );
  },
);

DeliveryToggleRow.displayName = 'DeliveryToggleRow';
