import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ThemeColors } from '../../constants/colors';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { AppNotification, NotificationTopic } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { formatClockTime } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

type Tint = Extract<
  keyof ThemeColors,
  | 'primary'
  | 'avatarPurple'
  | 'brandAccent'
  | 'avatarCyan'
  | 'notificationCoin'
  | 'gold'
  | 'notificationProduct'
  | 'destructive'
  | 'textSecondary'
>;

/**
 * Glyph and colour per topic, in one place.
 *
 * A row is recognised by its disc before a word of it is read, so the mapping
 * has to be exhaustive — adding a `NotificationTopic` without an entry here is
 * a type error rather than a row that arrives with an empty circle.
 *
 * Emoji rather than line icons, as in the shop: the disc is the only colour on
 * an otherwise grey row, and a stroked glyph at this size cannot carry a
 * trophy, a flame and a drop apart at a glance.
 */
const TOPIC_STYLE: Record<NotificationTopic, { emoji: string; tint: Tint }> = {
  steps: { emoji: '👣', tint: 'primary' },
  workout: { emoji: '💪', tint: 'avatarPurple' },
  streak: { emoji: '🔥', tint: 'brandAccent' },
  hydration: { emoji: '💧', tint: 'avatarCyan' },
  coins: { emoji: '🪙', tint: 'notificationCoin' },
  challenge: { emoji: '🏆', tint: 'gold' },
  reward: { emoji: '🎁', tint: 'notificationProduct' },
  health: { emoji: '❤️', tint: 'destructive' },
  system: { emoji: '⚙️', tint: 'textSecondary' },
};

const DISC_SIZE = moderateScale(44);
const DOT_SIZE = moderateScale(9);

interface Props {
  notification: AppNotification;
  onPress: (id: string) => void;
}

/**
 * One notification in the feed.
 *
 * The unread mark is a dot *and* the word "Unread" at the front of the row's
 * accessibility label: a blue disc against a grey one is the kind of
 * distinction that disappears for a colourblind reader, and it is the only
 * thing separating a row that needs attention from one that has had it.
 */
export const NotificationRow = memo(({ notification, onPress }: Props) => {
  const { colors, isDark } = useTheme();
  const { emoji, tint } = TOPIC_STYLE[notification.topic];
  const color = colors[tint];

  const handlePress = useCallback(
    () => onPress(notification.id),
    [notification.id, onPress],
  );

  const time = formatClockTime(notification.createdAt);

  return (
    <Pressable
      onPress={handlePress}
      feedback="highlight"
      accessibilityRole="button"
      accessibilityLabel={[
        notification.read ? null : 'Unread',
        notification.title,
        notification.message,
        time,
      ]
        .filter(Boolean)
        .join('. ')}
    >
      <HStack align="center" gap="md" py="md">
        <View
          style={[
            styles.disc,
            { backgroundColor: withAlpha(color, isDark ? 0.22 : 0.12) },
          ]}
        >
          <Emoji size="md">{emoji}</Emoji>
        </View>

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={1}>
            {notification.title}
          </AppText>
          {/*
            Two lines rather than one: these messages are a sentence, and the
            half of it that fits on a 375pt row rarely contains the figure the
            user opened the screen for.
          */}
          <AppText variant="caption" color="textSecondary" numberOfLines={2}>
            {notification.message}
          </AppText>
        </VStack>

        <HStack align="center" gap="sm">
          <AppText variant="micro" color="textTertiary" numberOfLines={1}>
            {time}
          </AppText>

          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[
              styles.dot,
              {
                backgroundColor: notification.read
                  ? colors.textQuaternary
                  : colors.primary,
              },
            ]}
          />
        </HStack>
      </HStack>
    </Pressable>
  );
});

NotificationRow.displayName = 'NotificationRow';

const styles = StyleSheet.create({
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
});
