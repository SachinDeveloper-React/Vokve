import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Send } from 'lucide-react-native';
import { useToast } from '../../components/feedback/Toast';
import { TextArea } from '../../components/form/TextArea';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { supportApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import { useCoinBalance } from '../../stores/coinsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { SupportTicket } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';
import { formatClockTime, formatRelativeDay } from '../../utils/format';

const makeStyles = ({ spacing, colors, radius }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    loading: { paddingVertical: spacing.xl, alignItems: 'center' },
    /** A member's message hugs the right; support's hugs the left. */
    mine: {
      alignSelf: 'flex-end',
      backgroundColor: colors.primary,
      borderRadius: radius.lg,
      borderBottomRightRadius: radius.sm,
      padding: spacing.md,
      maxWidth: '88%',
    },
    theirs: {
      alignSelf: 'flex-start',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderBottomLeftRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.md,
      maxWidth: '88%',
    },
  });

/** The timestamp under a member's own message, on the brand fill. */
const MINE_TIMESTAMP_OPACITY = 0.75;

const STATUS_LABEL = {
  open: 'Open',
  in_progress: 'With support',
  resolved: 'Resolved',
  closed: 'Closed',
} as const;

/**
 * One support conversation, as a thread.
 *
 * Drawn as messages rather than as a form with a history under it, because
 * that is what it is: the member wrote, support answered, the member can
 * write again. A closed ticket keeps its thread and loses its reply box —
 * a new question is a new ticket, which is how it stays findable.
 */
export const SupportTicketScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'SupportTicket'>['route']>();
  const toast = useToast();
  const balance = useCoinBalance();

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [isSending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supportApi
      .ticket(route.params.id)
      .then(result => {
        if (!cancelled) setTicket(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [route.params.id]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('HelpSupport');
  }, [navigation]);

  const onSend = useCallback(async () => {
    const message = reply.trim();
    if (message.length < 2 || !ticket) {
      return;
    }
    setSending(true);
    try {
      setTicket(await supportApi.reply(ticket.id, message));
      setReply('');
    } catch (error) {
      const apiError = toApiError(error);
      toast.show({
        title:
          apiError.code === 'TICKET_CLOSED'
            ? 'This ticket is closed'
            : "Couldn't send that",
        message: apiError.message,
        tone: 'warning',
      });
      if (apiError.code === 'TICKET_CLOSED') {
        supportApi
          .ticket(ticket.id)
          .then(setTicket)
          .catch(() => {});
      }
    } finally {
      setSending(false);
    }
  }, [reply, ticket, toast]);

  return (
    <Screen edges={['top']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title={ticket?.subject ?? 'Ticket'}
          subtitle={
            ticket
              ? `${ticket.reference} · opened ${formatRelativeDay(
                  ticket.createdAt,
                )}`
              : ' '
          }
        />

        {ticket === null ? (
          isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <Card radius="xl">
              <EmptyState
                title="Couldn't find that ticket"
                message="It may have been opened from another account."
                actionLabel="Back to help"
                onAction={onPressBack}
              />
            </Card>
          )
        ) : (
          <>
            <HStack align="center" justify="between">
              <AppText variant="label" color="textSecondary">
                Conversation
              </AppText>
              <Chip
                label={STATUS_LABEL[ticket.status]}
                tint={
                  ticket.status === 'resolved'
                    ? colors.success
                    : ticket.status === 'closed'
                    ? colors.textSecondary
                    : colors.primary
                }
              />
            </HStack>

            <VStack gap="sm">
              {ticket.messages.map(message => {
                const mine = message.from === 'user';
                return (
                  <View
                    key={message.id}
                    style={mine ? styles.mine : styles.theirs}
                  >
                    <VStack gap="xxs">
                      <AppText
                        variant="body"
                        style={
                          mine ? { color: colors.primaryForeground } : undefined
                        }
                      >
                        {message.body}
                      </AppText>
                      <AppText
                        variant="miniMicro"
                        style={{
                          color: mine
                            ? colors.primaryForeground
                            : colors.textTertiary,
                          opacity: mine ? MINE_TIMESTAMP_OPACITY : 1,
                        }}
                      >
                        {`${mine ? 'You' : 'Support'} · ${formatRelativeDay(
                          message.createdAt,
                        )}, ${formatClockTime(message.createdAt)}`}
                      </AppText>
                    </VStack>
                  </View>
                );
              })}
            </VStack>

            {ticket.status === 'closed' ? (
              <Card radius="xl" padding="base">
                <AppText variant="caption" color="textSecondary" center>
                  This ticket is closed. Open a new one from Help & Support and
                  we will pick it up there.
                </AppText>
              </Card>
            ) : (
              <VStack gap="sm">
                <TextArea
                  value={reply}
                  onChangeText={setReply}
                  placeholder="Add to this ticket…"
                  rows={3}
                  maxLength={2000}
                  accessibilityLabel="Your reply"
                />
                <Button
                  label="Send reply"
                  variant="brand"
                  fullWidth
                  loading={isSending}
                  disabled={isSending || reply.trim().length < 2}
                  icon={
                    <Icon as={Send} size="sm" tint={colors.primaryForeground} />
                  }
                  onPress={onSend}
                />
              </VStack>
            )}
          </>
        )}
      </KeyboardAwareScrollView>
    </Screen>
  );
};
