import React, { memo } from 'react';
import { Switch as RNSwitch } from 'react-native';
import { ChevronRight, Mail, MessageSquare, MoonStar } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { formatTimeOfDay } from '../../utils/format';
import type { QuietHours } from '../../stores/notificationSettingsStore';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';

interface RowProps {
  icon: LucideIcon;
  tint: string;
  title: string;
  subtitle: string;
}

const RowBody = memo(({ icon, tint, title, subtitle }: RowProps) => (
  <>
    <IconBadge icon={icon} tint={tint} size={34} shape="rounded" variant="muted" />

    <VStack flex={1} gap="xxs">
      <AppText variant="bodyStrong" numberOfLines={1}>
        {title}
      </AppText>
      <AppText variant="miniMicro" color="textSecondary" numberOfLines={2}>
        {subtitle}
      </AppText>
    </VStack>
  </>
));

RowBody.displayName = 'RowBody';

interface Props {
  quietHours: QuietHours;
  sms: boolean;
  email: boolean;
  onPressQuietHours: () => void;
  onChangeSms: (value: boolean) => void;
  onChangeEmail: (value: boolean) => void;
}

/**
 * How and when notifications arrive, once their subject is allowed.
 *
 * Its own card rather than a ninth row above: these three qualify every
 * category at once — quiet hours silence all of them, SMS and email are other
 * ways to receive the same things — and a switch that looked like a category
 * but behaved like a modifier is the kind of control users learn to distrust.
 */
export const NotificationPreferencesCard = memo(
  ({
    quietHours,
    sms,
    email,
    onPressQuietHours,
    onChangeSms,
    onChangeEmail,
  }: Props) => {
    const { colors } = useTheme();
    const window = `${formatTimeOfDay(quietHours.start)} – ${formatTimeOfDay(
      quietHours.end,
    )}`;

    return (
      <Card radius="xl" padding="base">
        <VStack gap="xs">
          <AppText variant="h3">Notification Preferences</AppText>

          <VStack>
            <Pressable
              onPress={onPressQuietHours}
              feedback="highlight"
              accessibilityRole="button"
              accessibilityLabel={`Quiet hours, ${
                quietHours.enabled ? `${window}, no notifications` : 'off'
              }`}
            >
              <HStack align="center" gap="md" py="md">
                <RowBody
                  icon={MoonStar}
                  tint={colors.avatarPurple}
                  title="Quiet Hours"
                  subtitle={quietHours.enabled ? window : 'Off'}
                />

                <AppText variant="micro" color="textSecondary" numberOfLines={1}>
                  {quietHours.enabled ? 'No notifications' : 'Always on'}
                </AppText>
                <Icon as={ChevronRight} size="sm" color="textTertiary" />
              </HStack>
            </Pressable>

            <Divider />

            <HStack align="center" gap="md" py="md">
              <RowBody
                icon={MessageSquare}
                tint={colors.primary}
                title="Delivery Updates via SMS"
                subtitle="Get order and delivery updates on SMS"
              />

              <RNSwitch
                value={sms}
                onValueChange={onChangeSms}
                trackColor={{
                  false: colors.switchBackground,
                  true: colors.brandAccent,
                }}
                thumbColor={colors.card}
                accessibilityRole="switch"
                accessibilityLabel="Delivery updates via SMS"
                accessibilityState={{ checked: sms }}
              />
            </HStack>

            <Divider />

            <HStack align="center" gap="md" py="md">
              <RowBody
                icon={Mail}
                tint={colors.success}
                title="Email Notifications"
                subtitle="Receive updates on your email"
              />

              <RNSwitch
                value={email}
                onValueChange={onChangeEmail}
                trackColor={{
                  false: colors.switchBackground,
                  true: colors.brandAccent,
                }}
                thumbColor={colors.card}
                accessibilityRole="switch"
                accessibilityLabel="Email notifications"
                accessibilityState={{ checked: email }}
              />
            </HStack>
          </VStack>
        </VStack>
      </Card>
    );
  },
);

NotificationPreferencesCard.displayName = 'NotificationPreferencesCard';
