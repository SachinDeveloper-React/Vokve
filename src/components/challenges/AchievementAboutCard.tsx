import React, { memo } from 'react';
import { FileText } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

interface Props {
  about: string;
}

/**
 * What the badge is for, in a sentence or two.
 *
 * The server's wording, derived from the rule it actually enforces, so a
 * threshold an owner rebalances does not leave the app explaining the old one.
 */
export const AchievementAboutCard = memo(({ about }: Props) => (
  <Card radius="xl" padding="base">
    <VStack gap="sm">
      <HStack align="center" gap="sm">
        <Icon as={FileText} size="sm" color="textSecondary" />
        <AppText variant="h3">About This Achievement</AppText>
      </HStack>

      <AppText variant="caption" color="textSecondary">
        {about}
      </AppText>
    </VStack>
  </Card>
));

AchievementAboutCard.displayName = 'AchievementAboutCard';
