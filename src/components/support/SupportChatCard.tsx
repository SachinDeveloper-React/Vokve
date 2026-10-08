import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { MessageCircle } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { withAlpha } from '../../utils/color';
import type { SupportHome } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { IconBadge } from '../ui/IconBadge';

interface Props {
  chat: SupportHome['chat'];
  busy?: boolean;
  onPress: () => void;
}

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    card: {
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: withAlpha(colors.destructive, 0.35),
      backgroundColor: withAlpha(colors.destructive, 0.08),
      padding: spacing.base,
    },
  });

/**
 * The way to a human, at the foot of the help centre.
 *
 * It is tinted apart from the rows above it because it is the one thing on
 * the page that is not an article: everything else answers the question
 * itself, this hands it to somebody. The reply time is the server's words,
 * never ours — it is a promise support has to be able to change, and a
 * screen that invented it could promise what nobody can keep.
 */
export const SupportChatCard = memo(({ chat, busy, onPress }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  return (
    <HStack align="center" gap="base" style={styles.card}>
      <IconBadge icon={MessageCircle} tint={colors.destructive} size={40} />

      <VStack flex={1} gap="xxs">
        <AppText variant="micro" color="textSecondary">
          {chat.subtitle}
        </AppText>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {chat.title}
        </AppText>
        <AppText variant="miniMicro" color="textTertiary" numberOfLines={2}>
          {chat.responseTime}
        </AppText>
      </VStack>

      <Button
        label={chat.openTicketId ? 'Continue' : 'Chat Now'}
        variant="destructive"
        size="sm"
        loading={busy}
        disabled={busy}
        onPress={onPress}
      />
    </HStack>
  );
});

SupportChatCard.displayName = 'SupportChatCard';
