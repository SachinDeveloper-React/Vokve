import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Clock } from 'lucide-react-native';
import { BrandSignOff } from '../../components/brand/BrandSignOff';
import { useToast } from '../../components/feedback/Toast';
import { Divider } from '../../components/layout/Divider';
import { PageHeader } from '../../components/layout/PageHeader';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { SupportChannelRow } from '../../components/support/SupportChannelRow';
import { SupportChatCard } from '../../components/support/SupportChatCard';
import { AppText } from '../../components/ui/AppText';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { supportApi } from '../../services/api/endpoints';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { SupportChannel, SupportHome } from '../../types/models';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxl, gap: spacing.md },
    loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
    signOff: { paddingTop: spacing.lg },
  });

/**
 * Every way of reaching support, and when there is somebody there.
 *
 * The channels are the server's, already assembled into links the OS can
 * open, so a change of number or address never waits on a release — and a
 * channel nobody is manning is simply not sent, rather than being offered
 * and ignored. The in-app ticket is kept at the foot as the one that
 * always works: it carries the app version and the device with it, which
 * is what support asks for first on any other channel.
 */
export const ContactUsScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const toast = useToast();

  const [home, setHome] = useState<SupportHome | null>(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supportApi
      .home()
      .then(result => {
        if (!cancelled) setHome(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('HelpSupport');
  }, [navigation]);

  const onChat = useCallback(() => {
    const openTicketId = home?.chat.openTicketId ?? null;
    if (openTicketId) {
      navigation.navigate('SupportTicket', { id: openTicketId });
      return;
    }
    navigation.navigate('ReportIssue', {});
  }, [home?.chat.openTicketId, navigation]);

  const onUnavailable = useCallback(
    (channel: SupportChannel) =>
      toast.show({
        title: `Couldn't open ${channel.label.toLowerCase()}`,
        message: `This device has nothing set up for that. ${channel.value} is the address.`,
        tone: 'warning',
      }),
    [toast],
  );

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader
          title="Contact Us"
          subtitle="Get in touch with our support team"
          onPressBack={onPressBack}
        />

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : home === null ? (
          <Card radius="xl">
            <EmptyState
              title="Couldn't load this"
              message="Check your connection and try again."
            />
          </Card>
        ) : (
          <>
            <Card radius="xl" padding="base">
              <VStack>
                {home.channels.map((channel, index) => (
                  <React.Fragment key={channel.kind}>
                    {index > 0 ? <Divider /> : null}
                    <SupportChannelRow
                      channel={channel}
                      onUnavailable={onUnavailable}
                    />
                  </React.Fragment>
                ))}
              </VStack>
            </Card>

            {home.hours ? (
              <Card radius="xl" padding="base">
                <HStack align="center" gap="md">
                  <Icon as={Clock} size="md" tint={colors.primary} />
                  <VStack flex={1} gap="xxs">
                    <AppText variant="bodyStrong">When we are in</AppText>
                    <AppText variant="caption" color="textSecondary">
                      {home.hours}
                    </AppText>
                  </VStack>
                </HStack>
              </Card>
            ) : null}

            <SupportChatCard chat={home.chat} onPress={onChat} />

            <View style={styles.signOff}>
              <BrandSignOff />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
};
