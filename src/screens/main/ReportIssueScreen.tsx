import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronRight, Send, ShieldCheck } from 'lucide-react-native';
import { useToast } from '../../components/feedback/Toast';
import {
  FormInput,
  FormSelect,
  FormTextArea,
} from '../../components/form/fields';
import { Pressable } from '../../components/form/Pressable';
import { Divider } from '../../components/layout/Divider';
import { PageHeader } from '../../components/layout/PageHeader';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Screen } from '../../components/ui/Screen';
import { supportApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import {
  supportTicketSchema,
  type SupportTicketValues,
} from '../../types/forms';
import type { SupportCategory, SupportTicket } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';
import { formatRelativeDay } from '../../utils/format';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    row: { paddingVertical: spacing.sm },
    grow: { flex: 1 },
  });

/** How each category reads in the picker — the member's words, not ours. */
export const SUPPORT_CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: 'orders', label: 'An order' },
  { value: 'coins', label: 'Coins & rewards' },
  { value: 'tracking', label: 'Steps & tracking' },
  { value: 'payments', label: 'A payment' },
  { value: 'account', label: 'My account' },
  { value: 'privacy', label: 'Privacy & security' },
  { value: 'other', label: 'Something else' },
];

export const SUPPORT_CATEGORY_LABEL: Record<SupportCategory, string> =
  Object.fromEntries(
    SUPPORT_CATEGORIES.map(entry => [entry.value, entry.label]),
  ) as Record<SupportCategory, string>;

/** How the ticket statuses read on a row. */
export const TICKET_STATUS_LABEL = {
  open: 'Open',
  in_progress: 'With support',
  resolved: 'Resolved',
  closed: 'Closed',
} as const;

/**
 * Telling support what went wrong, and everything already told.
 *
 * A full screen rather than the sheet this used to be: describing a
 * problem is writing, and writing wants the keyboard, the whole page and
 * no risk of a stray tap outside throwing the words away. The reports
 * already open sit under the form, because the commonest reason to come
 * back here is to see whether the last one was answered.
 *
 * The app version and the device ride along with the ticket without being
 * asked for — they are the first two things support needs and the last two
 * anyone wants to type.
 */
export const ReportIssueScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'ReportIssue'>['route']>();
  const toast = useToast();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [isSending, setSending] = useState(false);

  const form = useForm<SupportTicketValues>({
    resolver: zodResolver(supportTicketSchema),
    defaultValues: {
      subject: '',
      // Opened from a shelf, the form starts on what that shelf was about.
      category: route.params?.category ?? 'other',
      message: '',
    },
  });

  const loadTickets = useCallback(() => {
    supportApi
      .tickets()
      .then(setTickets)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('HelpSupport');
  }, [navigation]);

  const onSubmit = form.handleSubmit(async values => {
    setSending(true);
    try {
      const ticket = await supportApi.createTicket(values);
      form.reset({ subject: '', category: values.category, message: '' });
      toast.show({
        title: `Reported — ${ticket.reference}`,
        message: 'We reply inside the app, and you will get a notification.',
        tone: 'success',
      });
      navigation.navigate('SupportTicket', { id: ticket.id });
    } catch (error) {
      const apiError = toApiError(error);
      for (const [field, message] of Object.entries(apiError.fieldErrors)) {
        if (field in values) {
          form.setError(field as keyof SupportTicketValues, { message });
        }
      }
      if (Object.keys(apiError.fieldErrors).length === 0) {
        toast.show({
          title: "Couldn't send that",
          message: apiError.message,
          tone: 'error',
        });
      }
    } finally {
      setSending(false);
    }
  });

  return (
    <Screen edges={['top']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <PageHeader
          title="Report an Issue"
          subtitle="Facing a problem? Let us know"
          onPressBack={onPressBack}
        />

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <FormInput
              control={form.control}
              name="subject"
              label="What is it about?"
              placeholder="Coins missing after a walk"
            />
            <FormSelect
              control={form.control}
              name="category"
              label="Which part of the app?"
              sheetTitle="Choose a topic"
              options={SUPPORT_CATEGORIES}
            />
            <FormTextArea
              control={form.control}
              name="message"
              label="What happened?"
              placeholder="Tell us what you did, what you expected and what you saw instead."
              rows={6}
              showCount
              maxLength={2000}
            />

            <HStack align="center" gap="sm">
              <Icon as={ShieldCheck} size="sm" tint={colors.success} />
              <AppText
                variant="miniMicro"
                color="textTertiary"
                style={styles.grow}
              >
                Your app version and device are sent with this, so you do not
                have to describe your phone to us.
              </AppText>
            </HStack>

            <Button
              label="Send to support"
              variant="brand"
              size="lg"
              fullWidth
              loading={isSending}
              disabled={isSending}
              onPress={() => onSubmit()}
              icon={
                <Icon as={Send} size="sm" tint={colors.primaryForeground} />
              }
            />
          </VStack>
        </Card>

        {tickets.length > 0 ? (
          <Card radius="xl" padding="base">
            <VStack gap="xs">
              <AppText variant="label" color="textSecondary">
                What you have reported
              </AppText>
              {tickets.map((ticket, index) => (
                <React.Fragment key={ticket.id}>
                  {index > 0 ? <Divider /> : null}
                  <Pressable
                    onPress={() =>
                      navigation.navigate('SupportTicket', { id: ticket.id })
                    }
                    feedback="opacity"
                    accessibilityRole="button"
                    accessibilityLabel={`${ticket.subject}, ${
                      TICKET_STATUS_LABEL[ticket.status]
                    }`}
                    style={styles.row}
                  >
                    <HStack align="center" gap="md">
                      <VStack flex={1} gap="xxs">
                        <AppText variant="bodyStrong" numberOfLines={1}>
                          {ticket.subject}
                        </AppText>
                        <AppText variant="micro" color="textTertiary">
                          {`${ticket.reference} · ${
                            SUPPORT_CATEGORY_LABEL[ticket.category]
                          } · ${formatRelativeDay(ticket.updatedAt)}`}
                        </AppText>
                      </VStack>
                      <Chip
                        label={TICKET_STATUS_LABEL[ticket.status]}
                        tint={
                          ticket.status === 'resolved'
                            ? colors.success
                            : ticket.status === 'closed'
                            ? colors.textSecondary
                            : colors.primary
                        }
                      />
                      <Icon as={ChevronRight} size="sm" color="textTertiary" />
                    </HStack>
                  </Pressable>
                </React.Fragment>
              ))}
            </VStack>
          </Card>
        ) : null}
      </KeyboardAwareScrollView>
    </Screen>
  );
};
