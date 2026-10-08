import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Search } from 'lucide-react-native';
import { BrandSignOff } from '../../components/brand/BrandSignOff';
import { useToast } from '../../components/feedback/Toast';
import { FaqRow } from '../../components/account/FaqRow';
import { Input } from '../../components/form/Input';
import { Divider } from '../../components/layout/Divider';
import { PageHeader } from '../../components/layout/PageHeader';
import { VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { HelpTopicRow } from '../../components/support/HelpTopicRow';
import { SupportChatCard } from '../../components/support/SupportChatCard';
import { AppText } from '../../components/ui/AppText';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Screen } from '../../components/ui/Screen';
import { supportApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { SupportFaq, SupportHome, SupportTopic } from '../../types/models';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxl, gap: spacing.md },
    loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
    rows: { gap: spacing.md },
    signOff: { paddingTop: spacing.lg },
  });

/** How long the search box stays still before its text becomes a request. */
const DEBOUNCE_MS = 250;

/**
 * The help centre's front page (RULES P12).
 *
 * Everything on it is the server's: the rows and their order, which shelf
 * each one opens, and the promise at the foot about how soon we answer.
 * That is the point of a help centre — support answers a wave of the same
 * question by writing one row, not by waiting for an app release.
 *
 * The search box searches articles rather than rows, and takes the page
 * over while there is something in it: a member who types "refund" wants
 * the answer, not a category to pick through. Searching goes to the server
 * too, which matches the tags an article carries — which is how "my coins
 * are gone" finds the article called "Do my coins expire?".
 */
export const HelpSupportScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const toast = useToast();

  const [home, setHome] = useState<SupportHome | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SupportFaq[] | null>(null);
  const [isSearching, setSearching] = useState(false);

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

  // The search follows the box a beat behind, so typing is not a request each.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (query.length === 0) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    supportApi
      .faqs({ q: query })
      .then(found => {
        if (!cancelled) setResults(found);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Account' });
  }, [navigation]);

  /** Each row goes where its kind says — the server decides which that is. */
  const openTopic = useCallback(
    (topic: SupportTopic) => {
      switch (topic.kind) {
        case 'contact':
          navigation.navigate('ContactUs');
          return;
        case 'report':
          navigation.navigate('ReportIssue', {});
          return;
        case 'guide':
          navigation.navigate('AppGuide');
          return;
        default:
          navigation.navigate('HelpTopic', {
            title: topic.title,
            subtitle: topic.subtitle,
            category: topic.category,
          });
      }
    },
    [navigation],
  );

  /**
   * "Chat Now" carries on the conversation already open where there is one,
   * and starts a new one where there is not — so a member with a ticket
   * waiting is never handed a blank form about the same problem.
   */
  const onChat = useCallback(() => {
    const openTicketId = home?.chat.openTicketId ?? null;
    if (openTicketId) {
      navigation.navigate('SupportTicket', { id: openTicketId });
      return;
    }
    navigation.navigate('ReportIssue', {});
  }, [home?.chat.openTicketId, navigation]);

  const onRetry = useCallback(() => {
    setLoading(true);
    supportApi
      .home()
      .then(setHome)
      .catch(error =>
        toast.show({
          title: "Couldn't load help",
          message: toApiError(error).message,
          tone: 'warning',
        }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const searching = query.length > 0;

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader
          title="Help & Support"
          subtitle="We're here to help you"
          onPressBack={onPressBack}
        />

        <Input
          value={text}
          onChangeText={setText}
          placeholder="Search for help (e.g. coins, orders, steps...)"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          leading={<Icon as={Search} size="md" color="textTertiary" />}
          accessibilityLabel="Search for help"
        />

        {searching ? (
          <Card radius="xl" padding="base">
            <VStack gap="xs">
              <AppText variant="label" color="textSecondary">
                {results === null
                  ? 'Searching…'
                  : `${results.length} ${
                      results.length === 1 ? 'answer' : 'answers'
                    } for "${query}"`}
              </AppText>

              {results === null && isSearching ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : (results ?? []).length === 0 ? (
                <EmptyState
                  title="Nothing matched"
                  message="Try another word, or tell us what happened and we will answer it ourselves."
                  actionLabel="Report an issue"
                  onAction={() => navigation.navigate('ReportIssue', {})}
                />
              ) : (
                (results ?? []).map((faq, index) => (
                  <React.Fragment key={faq.id}>
                    {index > 0 ? <Divider /> : null}
                    <FaqRow faq={faq} defaultOpen={results!.length === 1} />
                  </React.Fragment>
                ))
              )}
            </VStack>
          </Card>
        ) : isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : home === null ? (
          <Card radius="xl">
            <EmptyState
              title="Couldn't load help"
              message="Check your connection and try again."
              actionLabel="Try again"
              onAction={onRetry}
            />
          </Card>
        ) : (
          <>
            <View style={styles.rows}>
              {home.topics.map(topic => (
                <HelpTopicRow
                  key={topic.id}
                  topic={topic}
                  onPress={openTopic}
                />
              ))}
            </View>

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
