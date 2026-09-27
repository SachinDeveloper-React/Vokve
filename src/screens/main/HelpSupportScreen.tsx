import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ChevronRight,
  LifeBuoy,
  MessageSquarePlus,
  Search,
} from 'lucide-react-native';
import { BottomSheet } from '../../components/disclosure/BottomSheet';
import { useToast } from '../../components/feedback/Toast';
import { FaqRow } from '../../components/account/FaqRow';
import {
  FormInput,
  FormSelect,
  FormTextArea,
} from '../../components/form/fields';
import { Input } from '../../components/form/Input';
import { Pressable } from '../../components/form/Pressable';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { Divider } from '../../components/layout/Divider';
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
import {
  supportTicketSchema,
  type SupportTicketValues,
} from '../../types/forms';
import type {
  SupportCategory,
  SupportFaq,
  SupportTicket,
} from '../../types/models';
import { formatRelativeDay } from '../../utils/format';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    loading: { paddingVertical: spacing.lg, alignItems: 'center' },
    chips: { gap: spacing.xs },
    grow: { flex: 1 },
    row: { paddingVertical: spacing.sm },
  });

/** How each category reads on a chip, and in the ticket form's picker. */
const CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: 'account', label: 'Account' },
  { value: 'coins', label: 'Coins' },
  { value: 'orders', label: 'Orders' },
  { value: 'tracking', label: 'Tracking' },
  { value: 'payments', label: 'Payments' },
  { value: 'other', label: 'Something else' },
];

const CATEGORY_LABEL: Record<SupportCategory, string> = Object.fromEntries(
  CATEGORIES.map(entry => [entry.value, entry.label]),
) as Record<SupportCategory, string>;

/** How the ticket statuses read and what colour they take. */
const STATUS_LABEL = {
  open: 'Open',
  in_progress: 'With support',
  resolved: 'Resolved',
  closed: 'Closed',
} as const;

/** How long the search box stays still before its text becomes a request. */
const DEBOUNCE_MS = 250;

/**
 * The help centre and the member's own tickets.
 *
 * The articles come from the server rather than the bundle, so support can
 * answer a wave of the same question by writing one row instead of waiting
 * for an app release. Searching goes to the server too — it matches the
 * tags an article carries, which is how "my coins are gone" finds the
 * article called "Do my coins expire?".
 *
 * Opening a ticket sends the app version and the device with it, because
 * those are the first two things support asks for and the last two anyone
 * wants to type.
 */
export const HelpSupportScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const toast = useToast();
  const balance = useCoinBalance();

  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [faqs, setFaqs] = useState<SupportFaq[] | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [isSearching, setSearching] = useState(false);
  const [isComposeOpen, setComposeOpen] = useState(false);
  const [isSending, setSending] = useState(false);

  const form = useForm<SupportTicketValues>({
    resolver: zodResolver(supportTicketSchema),
    defaultValues: { subject: '', category: 'other', message: '' },
  });

  // The search follows the box a beat behind, so typing is not a request each.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    supportApi
      .faqs({ q: query || undefined, category: category ?? undefined })
      .then(result => {
        if (!cancelled) setFaqs(result);
      })
      .catch(() => {
        if (!cancelled) setFaqs([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, query]);

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
    navigation.navigate('Main', { screen: 'Account' });
  }, [navigation]);

  const onPressCategory = useCallback(
    (value: SupportCategory) => () =>
      setCategory(current => (current === value ? null : value)),
    [],
  );

  const onSubmit = form.handleSubmit(async values => {
    setSending(true);
    try {
      const ticket = await supportApi.createTicket(values);
      form.reset();
      setComposeOpen(false);
      loadTickets();
      toast.show({
        title: `Ticket ${ticket.reference} opened`,
        message: 'We reply inside the app — you will get a notification.',
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
          title: "Couldn't open the ticket",
          message: apiError.message,
          tone: 'error',
        });
      }
    } finally {
      setSending(false);
    }
  });

  const heading = useMemo(() => {
    if (query.length > 0) {
      return `${faqs?.length ?? 0} ${
        faqs?.length === 1 ? 'article' : 'articles'
      } for "${query}"`;
    }
    return category
      ? `${CATEGORY_LABEL[category]} questions`
      : 'Common questions';
  }, [category, faqs?.length, query]);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title="Help & Support"
          subtitle="Answers first, and a human when they are not enough"
        />

        <Input
          value={text}
          onChangeText={setText}
          placeholder="Search help — coins, delivery, steps…"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          leading={<Icon as={Search} size="md" color="textTertiary" />}
          accessibilityLabel="Search help"
        />

        <HStack gap="xs" wrap style={styles.chips}>
          {CATEGORIES.map(entry => (
            <Pressable
              key={entry.value}
              onPress={onPressCategory(entry.value)}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityState={{ selected: category === entry.value }}
              accessibilityLabel={entry.label}
            >
              <Chip
                label={entry.label}
                tint={
                  category === entry.value
                    ? colors.primary
                    : colors.textSecondary
                }
              />
            </Pressable>
          ))}
        </HStack>

        <Card radius="xl" padding="base">
          <VStack gap="xs">
            <AppText variant="label" color="textSecondary">
              {heading}
            </AppText>

            {faqs === null && isSearching ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (faqs ?? []).length === 0 ? (
              <EmptyState
                title="Nothing matched"
                message="Try another word, or open a ticket and we will answer it ourselves."
                actionLabel="Open a ticket"
                onAction={() => setComposeOpen(true)}
              />
            ) : (
              (faqs ?? []).map((faq, index) => (
                <React.Fragment key={faq.id}>
                  {index > 0 ? <Divider /> : null}
                  <FaqRow
                    faq={faq}
                    defaultOpen={query.length > 0 && faqs!.length === 1}
                  />
                </React.Fragment>
              ))
            )}
          </VStack>
        </Card>

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <HStack align="center" gap="md">
              <Icon as={LifeBuoy} size="md" tint={colors.primary} />
              <VStack flex={1} gap="xxs">
                <AppText variant="bodyStrong">Still stuck?</AppText>
                <AppText variant="micro" color="textSecondary">
                  Open a ticket and we reply inside the app. Your app version
                  and device come along automatically.
                </AppText>
              </VStack>
            </HStack>
            <Button
              label="Open a ticket"
              variant="brand"
              fullWidth
              icon={
                <Icon
                  as={MessageSquarePlus}
                  size="sm"
                  tint={colors.primaryForeground}
                />
              }
              onPress={() => setComposeOpen(true)}
            />
          </VStack>
        </Card>

        {tickets.length > 0 ? (
          <Card radius="xl" padding="base">
            <VStack gap="xs">
              <AppText variant="label" color="textSecondary">
                Your tickets
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
                      STATUS_LABEL[ticket.status]
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
                            CATEGORY_LABEL[ticket.category]
                          } · ${formatRelativeDay(ticket.updatedAt)}`}
                        </AppText>
                      </VStack>
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
                      <Icon as={ChevronRight} size="sm" color="textTertiary" />
                    </HStack>
                  </Pressable>
                </React.Fragment>
              ))}
            </VStack>
          </Card>
        ) : null}
      </ScrollView>

      <BottomSheet
        visible={isComposeOpen}
        onClose={() => setComposeOpen(false)}
        title="Open a ticket"
        dismissible={!isSending}
      >
        <VStack gap="md" pb="base">
          <FormInput
            control={form.control}
            name="subject"
            label="Subject"
            placeholder="Coins missing after a walk"
          />
          <FormSelect
            control={form.control}
            name="category"
            label="What is it about?"
            sheetTitle="Category"
            options={CATEGORIES}
          />
          <FormTextArea
            control={form.control}
            name="message"
            label="What happened?"
            placeholder="Tell us what you did, what you expected and what you saw instead."
            rows={5}
            showCount
            maxLength={2000}
          />
          <Button
            label="Send to support"
            variant="brand"
            fullWidth
            loading={isSending}
            disabled={isSending}
            onPress={() => onSubmit()}
          />
        </VStack>
      </BottomSheet>
    </Screen>
  );
};
