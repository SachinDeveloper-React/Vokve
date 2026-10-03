import React, { memo } from 'react';
import { ChevronRight, GitCompare } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';

interface Props {
  onPress: () => void;
}

/** The way from the tracking screen to the step sources page. */
export const StepSourcesLinkCard = memo(({ onPress }: Props) => {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel="Step sources. Where your steps come from, and how they are matched"
    >
      <Card radius="xl" padding="base">
        <HStack align="center" gap="md">
          <IconBadge
            icon={GitCompare}
            tint={colors.avatarIndigo}
            shape="rounded"
          />
          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong">Step sources</AppText>
            <AppText variant="caption" color="textSecondary">
              Where your steps come from, and how they are matched
            </AppText>
          </VStack>
          <Icon as={ChevronRight} size="sm" color="textTertiary" />
        </HStack>
      </Card>
    </Pressable>
  );
});

StepSourcesLinkCard.displayName = 'StepSourcesLinkCard';
