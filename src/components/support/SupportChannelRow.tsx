import React, { memo, useCallback } from 'react';
import { Linking } from 'react-native';
import {
  ChevronRight,
  Mail,
  MessageCircle,
  Phone,
  type LucideIcon,
} from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { SupportChannel } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';

/** A glyph per way of reaching us, and the colour it carries. */
const LOOK: Record<
  SupportChannel['kind'],
  { icon: LucideIcon; tint: 'primary' | 'brandAccent' | 'success' }
> = {
  email: { icon: Mail, tint: 'primary' },
  phone: { icon: Phone, tint: 'brandAccent' },
  whatsapp: { icon: MessageCircle, tint: 'success' },
};

interface Props {
  channel: SupportChannel;
  /** Told when the phone has nothing that can open this kind of link. */
  onUnavailable?: (channel: SupportChannel) => void;
}

/**
 * One way of reaching support, ready to open.
 *
 * The link comes from the server already assembled — `mailto:`, `tel:`,
 * the WhatsApp address — so a change of number never waits on a release and
 * the app never has to know how each scheme is spelled.
 */
export const SupportChannelRow = memo(({ channel, onUnavailable }: Props) => {
  const { colors } = useTheme();
  const look = LOOK[channel.kind];

  const press = useCallback(() => {
    Linking.openURL(channel.url).catch(() => onUnavailable?.(channel));
  }, [channel, onUnavailable]);

  return (
    <Pressable
      onPress={press}
      feedback="opacity"
      accessibilityRole="button"
      accessibilityLabel={`${channel.label}, ${channel.value}`}
    >
      <HStack align="center" gap="base" py="md">
        <IconBadge icon={look.icon} tint={colors[look.tint]} size={40} />
        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong">{channel.label}</AppText>
          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
            {channel.value}
          </AppText>
          {channel.note ? (
            <AppText variant="miniMicro" color="textTertiary" numberOfLines={2}>
              {channel.note}
            </AppText>
          ) : null}
        </VStack>
        <Icon as={ChevronRight} size="sm" color="textTertiary" />
      </HStack>
    </Pressable>
  );
});

SupportChannelRow.displayName = 'SupportChannelRow';
