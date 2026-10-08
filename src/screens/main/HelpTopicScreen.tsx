import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Search } from 'lucide-react-native';
import { FaqRow } from '../../components/account/FaqRow';
import { Input } from '../../components/form/Input';
import { Divider } from '../../components/layout/Divider';
import { PageHeader } from '../../components/layout/PageHeader';
import { VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { SupportChatCard } from '../../components/support/SupportChatCard';
import { AppText } from '../../components/ui/AppText';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { supportApi } from '../../services/api/endpoints';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { SupportFaq, SupportHome } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxl, gap: spacing.md },
    loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
  });

const DEBOUNCE_MS = 250;

/**
 * One shelf of the help centre: every article on it, or the ones a search
 * narrows it to.
 *
 * The same screen serves "Frequently Asked Questions" and each of the
 * topic rows — they differ only by the category the server sent with the
 * row, which is why a new shelf needs no new screen. The chat card rides
 * along at the foot, because the moment an article does not answer it is
 * the moment a member wants a person.
 */
export const HelpTopicScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'HelpTopic'>['route']>();
  const { title, subtitle, category } = route.params;

  const [faqs, setFaqs] = useState<SupportFaq[] | null>(null);
  const [chat, setChat] = useState<SupportHome['chat'] | null>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supportApi
      .faqs({ q: query || undefined, category: category ?? undefined })
      .then(result => {
        if (!cancelled) setFaqs(result);
      })
      .catch(() => {
        if (!cancelled) setFaqs([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, query]);

  // The card at the foot carries the server's promise, so it is read from
  // the same place the front page reads it.
  useEffect(() => {
    let cancelled = false;
    supportApi
      .home()
      .then(home => {
        if (!cancelled) setChat(home.chat);
      })
      .catch(() => {});
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

  const onReport = useCallback(
    () => navigation.navigate('ReportIssue', { category: category ?? undefined }),
    [category, navigation],
  );

  const onChat = useCallback(() => {
    if (chat?.openTicketId) {
      navigation.navigate('SupportTicket', { id: chat.openTicketId });
      return;
    }
    onReport();
  }, [chat?.openTicketId, navigation, onReport]);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader
          title={title}
          subtitle={subtitle}
          onPressBack={onPressBack}
        />

        <Input
          value={text}
          onChangeText={setText}
          placeholder={`Search ${title.toLowerCase()}`}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          leading={<Icon as={Search} size="md" color="textTertiary" />}
          accessibilityLabel={`Search ${title}`}
        />

        <Card radius="xl" padding="base">
          <VStack gap="xs">
            <AppText variant="label" color="textSecondary">
              {query.length > 0
                ? `${faqs?.length ?? 0} ${
                    faqs?.length === 1 ? 'answer' : 'answers'
                  } for "${query}"`
                : 'Common questions'}
            </AppText>

            {faqs === null && isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (faqs ?? []).length === 0 ? (
              <EmptyState
                title="Nothing here yet"
                message="Tell us what happened and we will answer it ourselves."
                actionLabel="Report an issue"
                onAction={onReport}
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

        {chat ? <SupportChatCard chat={chat} onPress={onChat} /> : null}
      </ScrollView>
    </Screen>
  );
};
