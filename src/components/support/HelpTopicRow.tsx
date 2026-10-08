import React, { memo, useCallback } from 'react';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { SupportTopic } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';
import { SUPPORT_ICON, supportTint } from './supportLooks';

/** The disc's diameter at the 375pt baseline, as the design draws it. */
const DISC = 40;

interface Props {
  topic: SupportTopic;
  onPress: (topic: SupportTopic) => void;
}

/**
 * One row of the help centre: a tinted glyph, what it is, what is behind it.
 *
 * Each row is its own card rather than a divided list, because the rows go
 * to eight different places; a single bordered block would read as one
 * setting with eight lines. The count a shelf carries is deliberately not
 * drawn — the design does not ask for it, and "12 articles" sets an
 * expectation of volume rather than of an answer. It is still used: a shelf
 * with nothing on it is never sent, so a row is always a door onto
 * something.
 */
export const HelpTopicRow = memo(({ topic, onPress }: Props) => {
  const { colors } = useTheme();
  const press = useCallback(() => onPress(topic), [onPress, topic]);

  return (
    <Pressable
      onPress={press}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={`${topic.title}. ${topic.subtitle}`}
    >
      <Card radius="xl" padding="base">
        <HStack align="center" gap="base">
          <IconBadge
            icon={SUPPORT_ICON[topic.icon]}
            tint={supportTint(topic.tint, colors)}
            size={DISC}
          />
          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong" numberOfLines={1}>
              {topic.title}
            </AppText>
            <AppText variant="micro" color="textSecondary" numberOfLines={2}>
              {topic.subtitle}
            </AppText>
          </VStack>
          <Icon as={ChevronRight} size="sm" color="textTertiary" />
        </HStack>
      </Card>
    </Pressable>
  );
});

HelpTopicRow.displayName = 'HelpTopicRow';
